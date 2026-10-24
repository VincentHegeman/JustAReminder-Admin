// JustAReminder — beveiligd verwijderen van Supabase Auth-accounts.
// Supabase Edge Function: jar-admin-delete-account
// Deploy met verificatie van het JWT aan (standaard verify_jwt=true).
// Stel JAR_ADMIN_DELETE_CODE in via Supabase Edge Function Secrets (min. 12 tekens).
// SUPABASE_URL en SUPABASE_SERVICE_ROLE_KEY blijven uitsluitend server-side.
// Optioneel: JAR_ADMIN_ALLOWED_ORIGINS, komma-gescheiden exacte website-origins.
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const DELETE_CODE = Deno.env.get("JAR_ADMIN_DELETE_CODE") ?? "";
const rawOrigins = Deno.env.get("JAR_ADMIN_ALLOWED_ORIGINS") ?? "";
const allowedOrigins = rawOrigins.split(",").map((v) => v.trim()).filter(Boolean);

function corsHeaders(req: Request): HeadersInit {
  const origin = req.headers.get("origin") ?? "";
  const allowed = allowedOrigins.length === 0 ? "*" : (allowedOrigins.includes(origin) ? origin : "null");
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Vary": "Origin",
    "Cache-Control": "no-store",
  };
}
function reply(req: Request, status: number, payload: Record<string, unknown>): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json; charset=utf-8" },
  });
}
async function hash(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}
async function sameCode(provided: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([hash(provided), hash(expected)]);
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a[i] ^ b[i];
  return mismatch === 0;
}
function uuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(req) });
  if (req.method !== "POST") return reply(req, 405, { error: "Alleen POST toegestaan." });
  const origin = req.headers.get("origin") ?? "";
  if (allowedOrigins.length > 0 && origin && !allowedOrigins.includes(origin)) {
    return reply(req, 403, { error: "Deze website mag de functie niet aanroepen." });
  }
  if (!SUPABASE_URL || !SERVICE_KEY || DELETE_CODE.length < 12) {
    return reply(req, 503, { error: "Accountverwijdering is niet volledig ingesteld. Controleer de servergeheimen." });
  }
  const authorization = req.headers.get("authorization") ?? "";
  if (!/^Bearer\s+\S+$/i.test(authorization)) return reply(req, 401, { error: "Log opnieuw in als beheerder." });
  const jwt = authorization.replace(/^Bearer\s+/i, "");
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    // Auth- en admincontrole gebeuren op de SERVER, nooit via browserclaims.
    const { data: authData, error: authError } = await admin.auth.getUser(jwt);
    if (authError || !authData.user) return reply(req, 401, { error: "Je sessie is verlopen. Log opnieuw in." });
    const actorId = authData.user.id;
    const { data: adminRow, error: adminError } = await admin.from("jar_admins")
      .select("user_id").eq("user_id", actorId).maybeSingle();
    if (adminError || !adminRow) return reply(req, 403, { error: "Je account heeft geen beheerdersrechten." });

    // Alle aanvragen verbruiken een poging. Rate-limit is atomair in PostgreSQL.
    const { data: attempts, error: limitError } = await admin.rpc("jar_admin_delete_take_attempt", { p_actor: actorId });
    if (limitError) return reply(req, 503, { error: "Beveiligingscontrole ontbreekt. Voer eerst SQL-bestand 03 uit." });
    if (Number(attempts) > 5) return reply(req, 429, { error: "Te veel pogingen. Probeer het over 15 minuten opnieuw." });

    const raw = await req.text();
    if (raw.length > 4096) return reply(req, 413, { error: "Verzoek te groot." });
    let input: Record<string, unknown>;
    try { input = JSON.parse(raw); } catch { return reply(req, 400, { error: "Ongeldig verzoek." }); }
    const targetId = typeof input.userId === "string" ? input.userId : "";
    const confirmEmail = typeof input.confirmEmail === "string" ? input.confirmEmail.trim().toLowerCase() : "";
    const code = typeof input.deleteCode === "string" ? input.deleteCode : "";
    if (!uuid(targetId)) return reply(req, 400, { error: "Ongeldige account-ID." });
    if (actorId === targetId) return reply(req, 403, { error: "Je kunt je eigen beheerdersaccount niet verwijderen." });
    if (input.subscriptionChecked !== true || input.irreversibleConfirmed !== true) {
      return reply(req, 400, { error: "Bevestig eerst beide veiligheidscontroles." });
    }
    if (!await sameCode(code, DELETE_CODE)) return reply(req, 403, { error: "Onjuiste verwijdercode." });

    // Andere admins zijn niet via het dashboard te verwijderen.
    const { data: otherAdmin, error: otherAdminError } = await admin.from("jar_admins")
      .select("user_id").eq("user_id", targetId).maybeSingle();
    if (otherAdminError) return reply(req, 503, { error: "Beheerderscontrole is mislukt." });
    if (otherAdmin) return reply(req, 403, { error: "Een beheerdersaccount kan niet via deze functie worden verwijderd." });

    const { data: targetResult, error: targetError } = await admin.auth.admin.getUserById(targetId);
    if (targetError || !targetResult.user) return reply(req, 404, { error: "Account bestaat niet (meer)." });
    const email = (targetResult.user.email ?? "").trim().toLowerCase();
    if (!email || !confirmEmail || confirmEmail !== email) {
      return reply(req, 400, { error: "Het bevestigde e-mailadres komt niet exact overeen." });
    }

    // Vaste gebeurtenis voor de audittrail vóórdat Auth mogelijk cascade-verwijderingen uitvoert.
    const { data: event, error: eventError } = await admin.from("jar_admin_deletion_events")
      .insert({ actor_user_id: actorId, target_user_id: targetId, target_email: email, status: "started" })
      .select("id").single();
    if (eventError || !event) return reply(req, 503, { error: "Auditregistratie niet beschikbaar. Account is niet verwijderd." });

    // Hard delete van het Auth-account. FK-beperkingen kunnen dit blokkeren:
    // we verwijderen nooit blind overige app- of Mollie-records.
    const { error: deleteError } = await admin.auth.admin.deleteUser(targetId, false);
    if (deleteError) {
      await admin.from("jar_admin_deletion_events").update({
        status: "failed", finished_at: new Date().toISOString(),
        error_message: "Supabase Auth heeft de verwijdering geweigerd (mogelijk gekoppelde data).",
      }).eq("id", event.id);
      return reply(req, 409, { error: "Supabase heeft het verwijderen geweigerd. Mogelijk bestaan gekoppelde records die eerst gecontroleerd moeten worden. Er is geen geforceerde databaseverwijdering uitgevoerd." });
    }

    const { error: finalizeError } = await admin.from("jar_admin_deletion_events")
      .update({ status: "deleted", finished_at: new Date().toISOString() }).eq("id", event.id);
    const { error: auditError } = await admin.from("jar_admin_audit").insert({
      actor_user_id: actorId, table_name: "auth.users", row_id: targetId,
      column_name: "account_deleted", old_value: { email, existed: true },
      new_value: { deleted: true },
      reason: "Definitief verwijderd via Admin Dashboard na verificatie van geheime code en e-mail",
    });
    // De verwijdering is werkelijk geslaagd; logproblemen mogen dit niet als falen presenteren.
    return reply(req, 200, {
      ok: true, message: "Supabase Auth-account definitief verwijderd.",
      userId: targetId, auditWarning: Boolean(finalizeError || auditError),
      billingNotice: "Controleer apart of Mollie-abonnementen zijn beëindigd en of gekoppelde gegevens moeten worden opgeschoond.",
    });
  } catch (err) {
    console.error("Admin-delete-fout (zonder geheime invoer):", err instanceof Error ? err.message : "onbekend");
    return reply(req, 500, { error: "Er ging iets mis op de server. Controleer de Edge Function logs." });
  }
});
