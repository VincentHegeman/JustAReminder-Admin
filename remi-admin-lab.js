/**
 * JUSTAREMINDER — Remi ADMIN AI Lab (ECHTE OpenAI-analyse)
 * Geen simulaties, geen vaste testantwoorden, geen databasewrites.
 * Vereist bestaande, ingelogde Supabase JS-client en gedeployde
 * Supabase Edge Function 'remi-interpret' die server-side OpenAI aanroept.
 *
 * Import:
 *   import { mountRemiAdminLab } from './remi-admin-lab.js';
 *   mountRemiAdminLab(document.querySelector('#remi-admin-lab'), supabaseClient);
 */
const e = (tag, className = '', text = '') => {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
};
const ALLOWED_KINDS = new Set(['appointment', 'task', 'reminder']);
const TYPE_NL = {appointment: 'Afspraak', task: 'Taak', reminder: 'Herinnering'};
const style = `
.remi-lab{font:inherit;color:inherit;max-width:850px;margin:0 auto;padding:16px 4px}
.remi-lab *{box-sizing:border-box}
.remi-lab .rl-panel{background:var(--remi-bg,#fff);color:var(--remi-fg,#1f2937);border:1px solid #ced3d9;border-radius:14px;padding:18px;margin:12px 0}
.remi-lab .rl-top{display:flex;align-items:center;gap:10px;flex-wrap:wrap;justify-content:space-between}
.remi-lab .rl-badge{border:1px solid #bbb;border-radius:99px;padding:4px 10px;font-size:.8rem}
.remi-lab .rl-description{color:#536071;font-size:.92rem;line-height:1.5}
.remi-lab textarea,.remi-lab input:not([type=checkbox]),.remi-lab select{border:1px solid #aeb8c3;border-radius:8px;padding:10px;background:#fff;color:#111;max-width:100%;font:inherit}
.remi-lab textarea{display:block;width:100%;min-height:120px;resize:vertical;margin:10px 0}
.remi-lab .rl-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.remi-lab .rl-field{display:flex;flex-direction:column;gap:5px;font-size:.9rem}
.remi-lab .rl-field input,.remi-lab .rl-field select{width:100%}
.remi-lab .rl-actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:12px}
.remi-lab button{border:1px solid #5c6672;background:white;color:#132130;padding:10px 15px;border-radius:9px;cursor:pointer;font:inherit;font-weight:600}
.remi-lab button.rl-primary{background:#225bd2;border-color:#225bd2;color:#fff}
.remi-lab button:disabled{opacity:.5;cursor:not-allowed}
.remi-lab .rl-alert{padding:9px 11px;border-radius:8px;background:#fff4db;color:#754900;margin:12px 0}
.remi-lab .rl-error{padding:9px 11px;border-radius:8px;background:#fff0f0;color:#9b1b21;margin:12px 0}
.remi-lab .rl-success{padding:9px 11px;border-radius:8px;background:#ecfdf3;color:#146c3a;margin:12px 0}
.remi-lab .rl-proposal{border:1px solid #cfd5db;padding:13px;border-radius:12px;margin:13px 0}
.remi-lab .rl-heading{display:flex;align-items:center;gap:8px;margin-bottom:11px}
.remi-lab .rl-checkbox{display:inline-flex;align-items:center;gap:7px;margin:6px 0}
.remi-lab .rl-summary{white-space:pre-line;margin-top:10px}
.remi-lab h2,.remi-lab h3{margin:0 0 9px;font-weight:700;line-height:1.3}
@media(max-width:640px){.remi-lab .rl-grid{grid-template-columns:1fr}.remi-lab .rl-panel{padding:12px}}
`;

function field(text, input) {
  const label = e('label','rl-field');
  label.append(e('span','',text), input);
  return label;
}
function input(type, value, options={}) {
  const node=e('input');
  node.type=type;
  if (value !== null && value !== undefined) node.value=String(value);
  Object.assign(node, options);
  return node;
}
function checkbox(label, checked=false) {
  const holder=e('label','rl-checkbox');
  const node=input('checkbox'); node.checked=checked;
  holder.append(node,e('span','',label));
  return {holder,node};
}
function errorText(error) {
  if (!error) return 'Onbekende fout';
  return error.message || String(error);
}
async function decodeInvokeError(error) {
  const status=error?.context?.status;
  let detail='';
  try {
    if (error?.context instanceof Response) {
      const body = await error.context.clone().json();
      if (body && typeof body.error==='string') detail=body.error.slice(0,250);
    }
  } catch { /* Geen JSON: toon algemene fout. */ }
  if (status===401) return '401: Je bent niet correct ingelogd. Log opnieuw in bij JustAReminder en herlaad de ADMIN-pagina.';
  if (status===403) return '403: Je account mag deze test niet uitvoeren.';
  if (status===404) return '404: Edge Function remi-interpret niet gevonden. Controleer de deployment.';
  if (status===429) return '429: Te veel aanvragen. Probeer later opnieuw.';
  return (status?`HTTP ${status}: `:'') + (detail||errorText(error));
}
function validateItem(value) {
  if (!value || !ALLOWED_KINDS.has(value.kind)) return false;
  if (typeof value.title!=='string' || !value.title.trim()) return false;
  if (value.date!==null && value.date!==undefined && !/^\d{4}-\d{2}-\d{2}$/.test(value.date)) return false;
  if (value.time!==null && value.time!==undefined && !/^([01]\d|2[0-3]):[0-5]\d$/.test(value.time)) return false;
  return true;
}

export function mountRemiAdminLab(root, supabase) {
  if (!(root instanceof HTMLElement)) throw new Error('ADMIN-container ontbreekt.');
  if (!supabase?.auth?.getUser || !supabase?.functions?.invoke) throw new Error('Bestaande ingelogde Supabase-client ontbreekt.');
  root.replaceChildren(); root.classList.add('remi-lab');
  if (!document.getElementById('remi-admin-lab-style')) {
    const tag=e('style'); tag.id='remi-admin-lab-style'; tag.textContent=style; document.head.append(tag);
  }
  const panel=e('section','rl-panel');
  const top=e('div','rl-top');
  top.append(e('h2','','🤖 Remi — ECHTE AI-test'),e('span','rl-badge','ADMIN · test · geen opslag'));
  const intro=e('p','rl-description','De tekst wordt naar de bestaande Supabase Edge Function gestuurd. Alleen een echt OpenAI-resultaat wordt getoond. Er zijn GEEN voorbeeldresultaten of lokale herkenningsregels.');
  const message=e('textarea'); message.maxLength=2000;
  message.placeholder='Hey Remi, morgen om 4 uur heb ik Sanne als klant, om 6 uur Britt en om 8 uur eet ik bij mijn moeder.';
  message.value='Hey Remi, morgen om 4 uur heb ik Sanne als klant, om 6 uur Britt en om 8 uur eet ik bij mijn moeder.';
  const actions=e('div','rl-actions');
  const analyze=e('button','rl-primary','Analyseer met échte OpenAI'); analyze.type='button';
  const clear=e('button','','Wis resultaten'); clear.type='button';
  actions.append(analyze,clear);
  const status=e('div'); status.setAttribute('role','status'); status.setAttribute('aria-live','polite');
  const results=e('section');
  panel.append(top,intro,message,actions,status,results); root.append(panel);
  const setStatus=(text,kind='')=>{status.className=kind;status.textContent=text;};
  clear.addEventListener('click',()=>{results.replaceChildren();setStatus('Resultaten gewist. Er is niets opgeslagen.');});
  analyze.addEventListener('click', async()=>{
    const msg=message.value.trim();
    results.replaceChildren();
    if (!msg) return setStatus('Schrijf eerst een bericht.','rl-alert');
    analyze.disabled=true; setStatus('Verbinding maken en AI-analyse uitvoeren...');
    try {
      const {data:auth,error:authError}=await supabase.auth.getUser();
      if (authError||!auth?.user) throw new Error('Log in met je JustAReminder-account voordat je test.');
      const timezone=Intl.DateTimeFormat().resolvedOptions().timeZone||'Europe/Amsterdam';
      const {data,error}=await supabase.functions.invoke('remi-interpret',{body:{message:msg,timezone}});
      if(error) throw new Error(await decodeInvokeError(error));
      if(!data || data.ai!==true || data.provider!=='OpenAI' || data.saved!==false || !Array.isArray(data.items))
        throw new Error('Geen verifieerbaar AI-testantwoord: verwacht ai:true, provider:OpenAI, saved:false en items[].');
      if(!data.items.every(validateItem)) throw new Error('AI-resultaat bevat ongeldige voorstellen. Er is niets bevestigd.');
      setStatus(`Echt AI-antwoord ontvangen · ${data.model||'model niet vermeld'} · ${data.items.length} voorstel(len) · 0 opgeslagen`,'rl-success');
      renderReview(results,data,timezone);
    } catch(err) {setStatus(`Analyse mislukt: ${errorText(err)}`,'rl-error');}
    finally {analyze.disabled=false;}
  });
}

function renderReview(section, data, timezone){
  section.replaceChildren();
  const intro=e('p','rl-summary',data.summary||''); section.append(intro);
  if(!data.items.length){section.append(e('p','','De AI heeft geen voorstellen herkend.'));return;}
  section.append(e('h3','','Controleer de AI-voorstellen'));
  const rows=[];
  for(const proposal of data.items){
    const card=e('article','rl-proposal');
    const head=e('div','rl-heading');
    const include=checkbox('Dit voorstel opnemen',true); head.append(include.holder);
    const grid=e('div','rl-grid');
    const kind=e('select');
    for(const [code,label] of Object.entries(TYPE_NL)){
      const opt=e('option','',label); opt.value=code;kind.append(opt);
    }
    kind.value=proposal.kind;
    const title=input('text',proposal.title,{maxLength:200});
    const date=input('date',proposal.date||'');
    const time=input('time',proposal.time||'');
    const notification=input('number',proposal.notification_minutes_before??'',{min:'0',max:'10080',step:'1'});
    grid.append(field('Soort',kind),field('Titel',title),field('Datum',date),field('Tijd',time),field('Melding: minuten vooraf (leeg = geen)',notification));
    card.append(head,grid);
    if(proposal.needs_clarification||proposal.clarification_question){
      card.append(e('p','rl-alert','⚠️ '+(proposal.clarification_question||'Controleer de onduidelijke gegevens.')));
    }
    if(proposal.source_excerpt){card.append(e('p','rl-description',`Herkenning uit: “${proposal.source_excerpt}”`));}
    const reviewed=checkbox('Ik heb dit voorstel gecontroleerd',false); card.append(reviewed.holder);
    section.append(card);
    rows.push({include:include.node,reviewed:reviewed.node,kind,title,date,time,notification});
  }
  const state=e('p');state.setAttribute('role','status');
  const actions=e('div','rl-actions');
  const confirm=e('button','rl-primary','Bevestig voor test (zonder opslaan)'); confirm.type='button';
  const cancel=e('button','','Annuleren');cancel.type='button';
  actions.append(confirm,cancel);section.append(actions,state);
  cancel.addEventListener('click',()=>{section.replaceChildren();section.append(e('p','','Alle voorstellen geannuleerd. Niets opgeslagen.'));});
  confirm.addEventListener('click',()=>{
    state.className='';state.textContent='';
    const selected=rows.filter(r=>r.include.checked);
    if(!selected.length){state.className='rl-error';state.textContent='Selecteer minstens één voorstel.';return;}
    const confirmed=[];
    for(const row of selected){
      if(!row.reviewed.checked){state.className='rl-error';state.textContent='Vink bij elk geselecteerd voorstel aan dat je het hebt gecontroleerd.';return;}
      const item={kind:row.kind.value,title:row.title.value.trim(),date:row.date.value||null,time:row.time.value||null,
        timezone,notification_minutes_before:row.notification.value===''?null:Number(row.notification.value)};
      if(item.title.length<2){state.className='rl-error';state.textContent='Geef elk voorstel een duidelijke titel.';return;}
      if(item.kind!=='task'&&(!item.date||!item.time)){state.className='rl-error';state.textContent='Vul voor elke afspraak/herinnering zowel datum als tijd in.';return;}
      if(item.notification_minutes_before!==null&&(!Number.isInteger(item.notification_minutes_before)||item.notification_minutes_before<0||item.notification_minutes_before>10080)){
        state.className='rl-error';state.textContent='Meldingstijd ongeldig.';return;
      }
      confirmed.push(item);
    }
    // Alleen lokale review. GEEN insert/upsert/update of andere database-aanroep.
    section.replaceChildren();
    section.append(e('p','rl-success',`✅ ${confirmed.length} voorstel(len) lokaal bevestigd. Niets in Supabase opgeslagen.`));
    const details=e('ul');
    for(const item of confirmed){details.append(e('li','',`${TYPE_NL[item.kind]}: ${item.title} — ${item.date||'geen datum'} ${item.time||'geen tijd'}`));}
    section.append(details);
  });
}
