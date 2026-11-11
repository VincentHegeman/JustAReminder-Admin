(function(){
"use strict";
const $=id=>document.getElementById(id);
const S={sb:null,user:null,clients:[],visits:[],view:"overview",month:new Date(new Date().getFullYear(),new Date().getMonth(),1),day:"",search:"",status:"all",busy:false,config:null};
const eur=n=>new Intl.NumberFormat("nl-NL",{style:"currency",currency:"EUR"}).format(Number(n)||0);
const x=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const dateKey=d=>[d.getFullYear(),String(d.getMonth()+1).padStart(2,"0"),String(d.getDate()).padStart(2,"0")].join("-");
const parseDate=s=>new Date(Number(String(s).slice(0,4)),Number(String(s).slice(5,7))-1,Number(String(s).slice(8,10)),12);
const addDays=(s,n)=>dateKey(new Date(parseDate(s).getFullYear(),parseDate(s).getMonth(),parseDate(s).getDate()+n,12));
const showDate=s=>s?new Intl.DateTimeFormat("nl-NL",{weekday:"short",day:"numeric",month:"short",year:"numeric"}).format(parseDate(s)):"—";
const monthLabel=d=>new Intl.DateTimeFormat("nl-NL",{month:"long",year:"numeric"}).format(d);
const now=()=>dateKey(new Date());
const statuses={planned:"Gepland",done:"Uitgevoerd",skipped:"Overgeslagen",cancelled:"Geannuleerd"};
const payLabels={to_invoice:"Te factureren",invoiced:"Gefactureerd",paid:"Betaald"};
const intervals=[1,2,3,4,6,8,12,16,26,52],durations=[15,20,30,45,60,90,120,180,240];
const client=id=>S.clients.find(c=>c.id===id);
const jobs=id=>S.visits.filter(v=>v.client_id===id).sort((a,b)=>a.service_date.localeCompare(b.service_date)||a.start_time.localeCompare(b.start_time));
const address=c=>[c.street,[c.postal_code,c.city].filter(Boolean).join(" ")].filter(Boolean).join(", ");
const start=v=>String(v.start_time||"09:00").slice(0,5);
const total=arr=>arr.reduce((sum,v)=>sum+Number(v.price_eur||0),0);
const fullLabel=v=>{const c=client(v.client_id);return c?c.name:"Klant verwijderd";};
const statusPill=v=>'<span class="pill '+x(v)+'">'+x(statuses[v]||v)+'</span>';
const payPill=v=>'<span class="pill '+x(v)+'">'+x(payLabels[v]||v)+'</span>';
function message(text,isError=false){const target=$("toast");target.innerHTML='<div class="toast-msg'+(isError?' error':'')+'">'+x(text)+'</div>';clearTimeout(message.timer);message.timer=setTimeout(()=>target.replaceChildren(),4900);}
function setAuth(html){$("auth").classList.remove("hidden");$("shell").classList.add("hidden");$("auth-content").innerHTML=html;}
function errText(e){if(!e)return "Onbekende fout";if(e.code==="23505")return "Voor deze klant bestaat op die datum al een bezoek.";return e.message||String(e);}
function storageConfig(){try{return JSON.parse(localStorage.getItem("jar_admin_config_v1")||"null");}catch{return null;}}
function configForm(note=""){
setAuth((note?'<div class="auth-error">'+x(note)+'</div>':"")+
'<form id="setup-form"><div class="field"><label>Supabase project-URL</label><input name="url" type="url" placeholder="https://project.supabase.co" required></div>'+
'<div class="field"><label>Publishable / anon sleutel (nooit service_role)</label><textarea name="key" required placeholder="sb_publishable_…"></textarea></div>'+
'<button class="primary" type="submit">Verbinding instellen</button></form><p class="hint">Dezelfde beveiligde verbinding als je bestaande Admin v4. Alleen een publieke sleutel gebruiken.</p>');
}
function loginForm(note=""){
setAuth((note?'<div class="auth-error">'+x(note)+'</div>':"")+
'<form id="login-form"><div class="field"><label>E-mailadres</label><input name="email" autocomplete="username" type="email" required></div>'+
'<div class="field"><label>Wachtwoord</label><input name="password" type="password" autocomplete="current-password" required></div>'+
'<button class="primary" type="submit">Inloggen bij Admin</button></form>'+
'<p class="hint">Alleen de beheerdersaccounts van JustAReminder krijgen toegang.</p>'+
'<button type="button" class="outline" data-action="change-config">Verbinding aanpassen</button>');
}
async function boot(){
 S.day=now();
 if(!window.supabase?.createClient){setAuth('<div class="auth-error">Supabase kon niet worden geladen. Controleer je internetverbinding en herlaad.</div>');return;}
 const cfg=storageConfig();if(!cfg?.url||!cfg?.key){configForm();return;}
 if(!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(cfg.url)||/service_role|sb_secret_/i.test(cfg.key)){configForm("Bestaande verbinding is niet geldig.");return;}
 try{S.config=cfg;S.sb=window.supabase.createClient(cfg.url.replace(/\/$/,""),cfg.key,{auth:{persistSession:true,autoRefreshToken:true}});
 const {data,error}=await S.sb.auth.getUser();if(error||!data?.user){loginForm();return;}await authorize(data.user);}
 catch(e){loginForm(errText(e));}
}
async function authorize(user){
 const {data,error}=await S.sb.rpc("jar_admin_is_admin");
 if(error||data!==true){loginForm("Dit account heeft geen Admin-rechten. Log in met je bestaande beheerder.");return;}
 S.user=user;$("auth").classList.add("hidden");$("shell").classList.remove("hidden");await load();
}
async function fetchAll(table,by){
 let out=[],offset=0;
 while(true){const {data,error}=await S.sb.from(table).select("*").eq("owner_id",S.user.id).order(by,{ascending:true}).range(offset,offset+499);
 if(error)throw error;out.push(...(data||[]));if(!data||data.length<500)break;offset+=500;if(offset>20000)throw new Error("Meer dan 20.000 records: exporteer of archiveer oudere gegevens.");}
 return out;
}
async function load(){
 try{const [cs,vs]=await Promise.all([fetchAll("glass_clients","name"),fetchAll("glass_visits","service_date")]);S.clients=cs;S.visits=vs;render();}
 catch(e){$("content").innerHTML='<div class="auth-error"><b>Gegevens laden mislukt</b><p>'+x(errText(e))+'</p><button class="outline" id="retry">Opnieuw proberen</button></div>';message(errText(e),true);}
}
function navigate(page){S.view=page;S.search="";S.status="all";$("sidebar").classList.remove("open");render();}
function stat(label,value,detail,cls=""){return '<div class="stat"><div class="stat-label">'+x(label)+'</div><strong class="stat-value '+cls+'">'+x(value)+'</strong><small>'+x(detail)+'</small></div>';}
function empty(title,detail){return '<div class="empty"><b>'+x(title)+'</b><small>'+x(detail)+'</small></div>';}
function rowList(items,showNext=false){
 if(!items.length)return empty("Geen bezoeken gevonden","Voeg klanten toe en plan een eerste bezoek.");
 return '<div class="table-wrap"><table><thead><tr><th>Datum & tijd</th><th>Klant / adres</th><th>Status</th><th>Bedrag</th><th>Acties</th></tr></thead><tbody>'+
 items.map(v=>{const c=client(v.client_id);return '<tr><td><b>'+x(showDate(v.service_date))+'</b><br>'+x(start(v))+' · '+x(v.duration_minutes)+' min</td>'+
 '<td><strong>'+x(c?.name||"Onbekend")+'</strong><br>'+x(c?address(c):"")+'</td><td>'+statusPill(v.status)+'</td><td>'+x(eur(v.price_eur))+'</td>'+
 '<td><div class="actions"><button class="tiny" data-action="edit-visit" data-id="'+x(v.id)+'">Bewerk</button>'+
 (v.status==="planned"?'<button class="tiny" data-action="done-next" data-id="'+x(v.id)+'">✓ Klaar + volgende</button>':"")+
 (showNext?'<button class="tiny" data-action="delete-visit" data-id="'+x(v.id)+'">Verwijder</button>':"")+
 '</div></td></tr>';}).join("")+'</tbody></table></div>';
}
function dueCustomers(){
 const limit=addDays(now(),14);
 return S.clients.filter(c=>c.active).map(c=>{const list=jobs(c.id).filter(v=>v.status!=="cancelled"&&v.status!=="skipped");const latest=list.at(-1);const next=latest?addDays(latest.service_date,7*Number(c.interval_weeks)):now();const upcoming=list.find(v=>v.status==="planned"&&v.service_date>=now());return {c,next,upcoming};})
 .filter(v=>!v.upcoming&&v.next<=limit).sort((a,b)=>a.next.localeCompare(b.next));
}
function renderOverview(){
 const today=now(),week=addDays(today,7),month=today.slice(0,7);
 const todayJobs=S.visits.filter(v=>v.service_date===today&&v.status==="planned");
 const weekJobs=S.visits.filter(v=>v.service_date>=today&&v.service_date<week&&v.status==="planned");
 const completed=S.visits.filter(v=>v.status==="done"&&v.service_date.startsWith(month));
 const toBill=S.visits.filter(v=>v.status==="done"&&v.payment_status==="to_invoice");
 const nextJobs=S.visits.filter(v=>v.status==="planned"&&v.service_date>=today).sort((a,b)=>a.service_date.localeCompare(b.service_date)||start(a).localeCompare(start(b))).slice(0,7);
 const due=dueCustomers().slice(0,7);
 return '<div class="hero"><div><h2>Goedemorgen! Tijd voor overzicht.</h2><p>Alle adressen, wasbeurten en terugkerende afspraken op één plek. Je administratie staat veilig en gescheiden van JustAReminder.</p></div><button class="primary" data-action="new-client">+ Nieuwe klant</button></div>'+
 '<div class="stats">'+stat("Actieve klanten",S.clients.filter(c=>c.active).length,"In je klantenbestand","accent")+stat("Vandaag gepland",todayJobs.length,"Bezoeken om uit te voeren")+stat("Komende 7 dagen",weekJobs.length,"In de agenda","green")+stat("Nog te factureren",eur(total(toBill)),completed.length+" uitgevoerd deze maand","orange")+'</div>'+
 '<div class="layout-2"><section class="panel"><div class="panel-header"><div><h2>Volgende werkopdrachten</h2><p>Geplande afspraken vanaf vandaag</p></div><button class="outline small" data-page="calendar">Bekijk agenda</button></div>'+rowList(nextJobs)+'</section>'+
 '<section class="panel"><div class="panel-header"><div><h2>Opnieuw inplannen</h2><p>Volgens de frequentie per klant</p></div><button class="outline small" data-page="clients">Klanten</button></div><div class="panel-body">'+
 (due.length?due.map(d=>'<div class="line-item"><div><b>'+x(d.c.name)+'</b><small>'+x(d.c.city||"Geen plaats")+' · elke '+x(d.c.interval_weeks)+' weken</small></div><button class="tiny" data-action="plan-client" data-id="'+x(d.c.id)+'">Plan bezoek</button></div>').join(""):empty("Alles ingepland","Er zijn geen klanten die binnen twee weken een nieuwe afspraak nodig hebben."))+
 '<div class="notice">Tip: kies <b>Werkopdrachten → Herhaalplanning</b> om automatisch een reeks komende bezoeken aan te maken, zonder dubbele afspraken.</div></div></section></div>';
}
function dayJobs(day){return S.visits.filter(v=>v.service_date===day).sort((a,b)=>start(a).localeCompare(start(b)));}
function dailyCards(day){
 const vs=dayJobs(day);
 if(!vs.length)return empty("Geen werk gepland","Kies + Bezoek om een afspraak op deze datum te maken.");
 return '<div class="panel"><div class="panel-header"><div><h2>'+x(showDate(day))+'</h2><p>'+vs.length+' bezoeken · '+x(eur(total(vs.filter(v=>v.status!=="cancelled"))))+' gepland/uitgevoerd</p></div>'+
 '<div class="actions"><button class="outline small" data-action="route-day">↗ Open route</button><button class="primary small" data-action="new-visit">+ Bezoek</button></div></div><div class="panel-body">'+vs.map(v=>{const c=client(v.client_id);return '<div class="line-item"><div><b>'+x(start(v))+' · '+x(c?.name||"Onbekend")+'</b><small>'+x(c?address(c):"")+' · '+x(v.duration_minutes)+' minuten</small><div style="margin-top:5px">'+statusPill(v.status)+' '+payPill(v.payment_status)+'</div></div><div class="actions">'+(v.status==="planned"?'<button class="tiny" data-action="done-next" data-id="'+x(v.id)+'">✓ Klaar</button>':"")+'<button class="tiny" data-action="edit-visit" data-id="'+x(v.id)+'">Bewerk</button></div></div>';}).join("")+'</div></div>';
}
function renderCalendar(){
 const y=S.month.getFullYear(),m=S.month.getMonth(),first=new Date(y,m,1,12),lead=(first.getDay()+6)%7;
 const dates=Array.from({length:42},(_,i)=>dateKey(new Date(y,m,i+1-lead,12)));
 const counts=new Map();S.visits.forEach(v=>{const vlist=counts.get(v.service_date)||[];vlist.push(v);counts.set(v.service_date,vlist);});
 return '<div class="toolbar"><div class="toolbar-left"><button class="outline" data-action="prev-month">‹</button><span class="date-label">'+x(monthLabel(first))+'</span><button class="outline" data-action="next-month">›</button><button class="soft" data-action="calendar-today">Vandaag</button></div><div class="toolbar-right"><button class="outline" data-action="route-day">↗ Route geselecteerde dag</button><button class="primary" data-action="new-visit">+ Bezoek</button></div></div>'+
 '<div class="month-box"><div class="weekdays">'+["Ma","Di","Wo","Do","Vr","Za","Zo"].map(d=>'<div>'+d+'</div>').join("")+'</div><div class="day-grid">'+dates.map(d=>{const vs=counts.get(d)||[],today=d===now(),selected=d===S.day,other=!d.startsWith(dateKey(first).slice(0,7));return '<button class="day'+(today?' today':'')+(selected?' selected':'')+(other?' other':'')+'" data-action="select-day" data-id="'+d+'"><span class="day-num">'+Number(d.slice(8))+'</span>'+(vs.length?'<span class="day-count">'+vs.length+' bezoek'+(vs.length===1?'':'en')+'</span>':"")+vs.slice(0,2).map(v=>'<span class="day-job '+x(v.status)+'">'+x(start(v))+' '+x(fullLabel(v))+'</span>').join("")+'</button>';}).join("")+'</div></div>'+
 '<div class="day-details">'+dailyCards(S.day)+'</div>';
}
function clientRows(){
 const q=S.search.toLowerCase().trim();return S.clients.filter(c=>[c.name,c.street,c.city,c.postal_code,c.phone,c.email].join(" ").toLowerCase().includes(q));
}
function renderClients(){
 const rows=clientRows();
 return '<div class="section-title"><div><h2>Klantenbestand</h2><div class="hint">'+S.clients.length+' klanten · prijzen inclusief btw naar eigen instelling</div></div><div class="actions"><button class="outline" data-action="export-clients">↓ Export CSV</button><button class="primary" data-action="new-client">+ Klant toevoegen</button></div></div>'+
 '<div class="toolbar"><input class="search" id="list-search" placeholder="Zoek op naam, adres of telefoon…" value="'+x(S.search)+'"></div>'+
 '<div class="panel">'+(rows.length?'<div class="table-wrap"><table><thead><tr><th>Klant / adres</th><th>Contact</th><th>Frequentie</th><th>Prijs</th><th>Acties</th></tr></thead><tbody>'+rows.map(c=>'<tr><td><strong>'+x(c.name)+'</strong> '+(!c.active?'<span class="pill cancelled">Inactief</span>':"")+'<br>'+x(address(c)||"Geen adres")+'</td><td>'+x(c.phone||"—")+'<br>'+x(c.email||"")+'</td><td>Elke '+x(c.interval_weeks)+' weken<br>'+x(c.duration_minutes)+' min.</td><td>'+x(eur(c.price_eur))+'</td><td><div class="actions"><button class="tiny" data-action="plan-client" data-id="'+x(c.id)+'">Plan</button><button class="tiny" data-action="edit-client" data-id="'+x(c.id)+'">Bewerk</button><button class="tiny" data-action="delete-client" data-id="'+x(c.id)+'">Verwijder</button></div></td></tr>').join("")+'</tbody></table></div>':empty("Geen klanten gevonden","Maak een klant aan om een adres te gaan plannen."))+'</div>';
}
function filteredVisits(){
 const q=S.search.trim().toLowerCase();return S.visits.filter(v=>{const c=client(v.client_id);return (S.status==="all"||v.status===S.status)&&[c?.name,c?.street,c?.city,c?.postal_code,v.service_date,v.notes].join(" ").toLowerCase().includes(q);}).sort((a,b)=>a.service_date.localeCompare(b.service_date)||start(a).localeCompare(start(b));
}
function renderVisits(){
 const rows=filteredVisits();const future=rows.filter(v=>v.service_date>=now()),past=rows.filter(v=>v.service_date<now()).reverse();const visible=[...future,...past].slice(0,500);
 return '<div class="section-title"><div><h2>Werkopdrachten</h2><div class="hint">Bezoeken aanmaken, afronden, verplaatsen en herhalen</div></div><div class="actions"><button class="outline" data-action="export-visits">↓ Export CSV</button><button class="soft" data-action="bulk-generate">↻ Herhaalplanning (12 weken)</button><button class="primary" data-action="new-visit">+ Bezoek</button></div></div>'+
 '<div class="toolbar"><div class="toolbar-left"><input class="search" id="list-search" placeholder="Zoek klant of datum…" value="'+x(S.search)+'"><select id="status-filter" class="filter-select"><option value="all"'+(S.status==="all"?" selected":"")+'>Alle statussen</option>'+Object.entries(statuses).map(([v,l])=>'<option value="'+v+'"'+(S.status===v?" selected":"")+'>'+x(l)+'</option>').join("")+'</select></div><div class="hint">'+rows.length+' afspraken'+(rows.length>500?" · eerste 500 zichtbaar":"")+'</div></div>'+
 '<div class="panel">'+rowList(visible,true)+'</div>';
}
function renderFinance(){
 const done=S.visits.filter(v=>v.status==="done").sort((a,b)=>b.service_date.localeCompare(a.service_date));const unpaid=done.filter(v=>v.payment_status==="to_invoice");const invoiced=done.filter(v=>v.payment_status==="invoiced");const paid=done.filter(v=>v.payment_status==="paid");
 return '<div class="section-title"><div><h2>Factuurstatus</h2><div class="hint">Administratief overzicht; dit genereert of verstuurt geen echte facturen en raakt Mollie niet.</div></div><button class="outline" data-action="export-visits">↓ CSV-export</button></div>'+
 '<div class="stats">'+stat("Te factureren",eur(total(unpaid)),unpaid.length+" afgeronde opdrachten","orange")+stat("Gefactureerd",eur(total(invoiced)),invoiced.length+" te betalen facturen","accent")+stat("Betaald",eur(total(paid)),paid.length+" afgeronde betalingen","green")+stat("Uitgevoerde klussen",done.length,"Alle tijden")+'</div>'+
 '<div class="panel">'+(done.length?'<div class="table-wrap"><table><thead><tr><th>Datum</th><th>Klant</th><th>Bedrag</th><th>Factuurstatus</th><th>Bijwerken</th></tr></thead><tbody>'+done.slice(0,600).map(v=>'<tr><td>'+x(showDate(v.service_date))+'</td><td><strong>'+x(fullLabel(v))+'</strong></td><td>'+x(eur(v.price_eur))+'</td><td>'+payPill(v.payment_status)+'</td><td><div class="actions">'+(v.payment_status!=="to_invoice"?'<button class="tiny" data-action="set-payment" data-status="to_invoice" data-id="'+x(v.id)+'">Te factureren</button>':"")+(v.payment_status!=="invoiced"?'<button class="tiny" data-action="set-payment" data-status="invoiced" data-id="'+x(v.id)+'">Gefactureerd</button>':"")+(v.payment_status!=="paid"?'<button class="tiny" data-action="set-payment" data-status="paid" data-id="'+x(v.id)+'">Betaald</button>':"")+'</div></td></tr>').join("")+'</tbody></table></div>':empty("Nog geen afgeronde opdrachten","Markeer een bezoek als uitgevoerd om het hier terug te zien."))+'</div>';
}
function render(){
 if(!S.user)return;
 const titles={overview:"Overzicht",calendar:"Agenda",clients:"Klantenbestand",visits:"Werkopdrachten",finance:"Factuurstatus"};
 $("page-title").textContent=titles[S.view]||"Overzicht";
 $("sidebar").querySelectorAll("[data-page]").forEach(b=>b.classList.toggle("active",b.dataset.page===S.view));
 const page={overview:renderOverview,calendar:renderCalendar,clients:renderClients,visits:renderVisits,finance:renderFinance};
 $("content").innerHTML=(page[S.view]||renderOverview)();
}
function modal(title,content){
 $("modal-root").innerHTML='<div class="modal-backdrop" id="backdrop"><section class="dialog" role="dialog" aria-modal="true" aria-label="'+x(title)+'"><div class="dialog-head"><h2>'+x(title)+'</h2><button class="icon-button" data-action="close-modal" aria-label="Sluiten">×</button></div>'+content+'</section></div>';
 const first=$("modal-root").querySelector("input,select,textarea");first?.focus();
}
function field(label,name,value="",type="text",extra=""){return '<div class="field"><label>'+x(label)+'</label><input name="'+x(name)+'" type="'+x(type)+'" value="'+x(value)+'" '+extra+'></div>';}
function selectField(label,name,items,selected){return '<div class="field"><label>'+x(label)+'</label><select name="'+x(name)+'">'+items.map(item=>{const [val,title]=Array.isArray(item)?item:[item,item];return '<option value="'+x(val)+'"'+(String(val)===String(selected)?" selected":"")+'>'+x(title)+'</option>';}).join("")+'</select></div>';}
function area(label,name,value){return '<div class="field span2"><label>'+x(label)+'</label><textarea name="'+x(name)+'" maxlength="2500">'+x(value||"")+'</textarea></div>';}
function formFoot(){return '<div class="dialog-foot"><span id="form-error" class="error-inline"></span><button class="outline" type="button" data-action="close-modal">Annuleren</button><button class="primary" type="submit">Opslaan</button></div>';}
function clientModal(id){
 const c=id?client(id):null;if(id&&!c)return message("Klant niet gevonden",true);
 const content='<form id="client-form"><input type="hidden" name="id" value="'+x(c?.id||"")+'"><div class="dialog-body"><div class="form-grid">'+
 field("Klantnaam *","name",c?.name||"","text",'required maxlength="140"')+
 field("Telefoon","phone",c?.phone||"","tel",'maxlength="80"')+
 field("Straat en huisnummer","street",c?.street||"","text",'maxlength="200"')+
 field("Postcode","postal_code",c?.postal_code||"","text",'maxlength="25"')+
 field("Plaats","city",c?.city||"","text",'maxlength="100"')+
 field("E-mail","email",c?.email||"","email",'maxlength="180"')+
 field("Prijs per beurt (€)","price_eur",c?.price_eur??0,"number",'min="0" max="9999999" step="0.01" required')+
 selectField("Herhaling", "interval_weeks",intervals.map(v=>[v,"Elke "+v+" weken"]),c?.interval_weeks??4)+
 selectField("Geschatte tijd", "duration_minutes",durations.map(v=>[v,v+" minuten"]),c?.duration_minutes??30)+
 '<div class="field"><label>Actief</label><label class="checkbox-line"><input name="active" type="checkbox"'+(!c||c.active?" checked":"")+'> Meenemen in herhaalplanning</label></div>'+
 area("Opmerkingen over klant / woning","notes",c?.notes||"")+'</div></div>'+formFoot()+'</form>';
 modal(c?"Klant bewerken":"Nieuwe klant toevoegen",content);
}
function visitModal(id,clientId){
 if(!S.clients.length){message("Voeg eerst een klant toe",true);clientModal();return;}
 const v=id?S.visits.find(t=>t.id===id):null;if(id&&!v)return message("Bezoek niet gevonden",true);
 const selectedClient=client(v?.client_id||clientId)||S.clients[0];
 const clientOpts=S.clients.map(c=>[c.id,c.name+" · "+(c.city||"adres onbekend")]);
 const selectedDay=S.day||now(),serviceDate=v?.service_date||selectedDay;
 const content='<form id="visit-form"><input type="hidden" name="id" value="'+x(v?.id||"")+'"><div class="dialog-body"><div class="form-grid">'+
 selectField("Klant *","client_id",clientOpts,selectedClient.id)+
 field("Datum *","service_date",serviceDate,"date","required")+
 field("Starttijd *","start_time",start(v||{start_time:"09:00"}),"time","required")+
 selectField("Geschatte duur", "duration_minutes",durations.map(d=>[d,d+" minuten"]),v?.duration_minutes||selectedClient.duration_minutes)+
 field("Prijs (€)","price_eur",v?.price_eur??selectedClient.price_eur,"number",'min="0" max="9999999" step="0.01" required')+
 selectField("Werkstatus","status",Object.entries(statuses),v?.status||"planned")+
 selectField("Factuurstatus","payment_status",Object.entries(payLabels),v?.payment_status||"to_invoice")+
 '<div></div>'+area("Werkopmerkingen","notes",v?.notes||"")+
 '</div><p class="hint">Een bezoek is een eenmalige afspraak. Gebruik Herhaalplanning om de volgende wasbeurten te genereren.</p></div>'+formFoot()+'</form>';
 modal(v?"Bezoek bewerken":"Bezoek plannen",content);
 if(!v){$("modal-root").querySelector('[name="client_id"]').addEventListener("change",e=>{const c=client(e.target.value);if(!c)return;const form=$("visit-form");form.elements.price_eur.value=c.price_eur;form.elements.duration_minutes.value=String(c.duration_minutes);});}
}
async function saveClient(form){
 const f=new FormData(form),id=f.get("id");
 const data={name:String(f.get("name")||"").trim(),phone:String(f.get("phone")||"").trim(),street:String(f.get("street")||"").trim(),postal_code:String(f.get("postal_code")||"").trim(),city:String(f.get("city")||"").trim(),email:String(f.get("email")||"").trim(),price_eur:Number(f.get("price_eur")),interval_weeks:Number(f.get("interval_weeks")),duration_minutes:Number(f.get("duration_minutes")),active:f.has("active"),notes:String(f.get("notes")||"").trim(),updated_at:new Date().toISOString()};
 if(!data.name||!Number.isFinite(data.price_eur)||data.price_eur<0)throw Error("Vul de klantnaam en een geldige prijs in.");
 const q=id?S.sb.from("glass_clients").update(data).eq("id",id).eq("owner_id",S.user.id):S.sb.from("glass_clients").insert(data);
 const {error}=await q;if(error)throw error;
 message(id?"Klant bijgewerkt":"Klant toegevoegd");$("modal-root").replaceChildren();await load();
}
async function saveVisit(form){
 const f=new FormData(form),id=f.get("id");
 const data={client_id:String(f.get("client_id")),service_date:String(f.get("service_date")),start_time:String(f.get("start_time")),duration_minutes:Number(f.get("duration_minutes")),price_eur:Number(f.get("price_eur")),status:String(f.get("status")),payment_status:String(f.get("payment_status")),notes:String(f.get("notes")||"").trim(),updated_at:new Date().toISOString()};
 if(!client(data.client_id)||!data.service_date||!data.start_time||!Number.isFinite(data.price_eur)||data.price_eur<0)throw Error("Controleer klant, datum, tijd en bedrag.");
 data.completed_at=data.status==="done"?(S.visits.find(v=>v.id===id)?.completed_at||new Date().toISOString()):null;
 const q=id?S.sb.from("glass_visits").update(data).eq("id",id).eq("owner_id",S.user.id):S.sb.from("glass_visits").insert(data);
 const {error}=await q;if(error)throw error;
 $("modal-root").replaceChildren();S.day=data.service_date;message(id?"Bezoek bijgewerkt":"Bezoek gepland");await load();
}
async function updateVisit(id,payload){const {error}=await S.sb.from("glass_visits").update({...payload,updated_at:new Date().toISOString()}).eq("id",id).eq("owner_id",S.user.id);if(error)throw error;}
async function finish(id,withNext){
 const v=S.visits.find(z=>z.id===id);if(!v)return;
 await updateVisit(id,{status:"done",completed_at:v.completed_at||new Date().toISOString()});
 await load();
 if(withNext){const c=client(v.client_id);if(c&&c.active){try{const created=await nextVisit(c,v.service_date,v.start_time);message(created?"Bezoek afgerond, volgende beurt gepland":"Bezoek afgerond, volgende beurt staat al gepland.");}catch(e){message("Afgerond, maar volgende planning mislukt: "+errText(e),true);}}else message("Bezoek afgerond.");}
 else message("Bezoek afgerond.");
}
async function nextVisit(c,from,time="09:00"){
 if(!c||!c.active)return false;
 const list=jobs(c.id).filter(v=>!["cancelled","skipped"].includes(v.status));
 if(list.some(v=>v.status==="planned"&&v.service_date>from&&v.service_date>=now()))return false;
 const base=(list.length?list.at(-1).service_date:from||now());
 let date=addDays(base,list.length?7*c.interval_weeks:0);
 while(date<now())date=addDays(date,7*c.interval_weeks);
 if(list.some(v=>v.service_date===date))return false;
 const {error}=await S.sb.from("glass_visits").insert({client_id:c.id,service_date:date,start_time:String(time).slice(0,5),duration_minutes:c.duration_minutes,price_eur:c.price_eur});
 if(error){if(error.code==="23505")return false;throw error;}
 await load();return true;
}
async function bulkGenerate(){
 if(!S.clients.some(c=>c.active))return message("Geen actieve klanten.",true);
 if(!confirm("Voor alle actieve klanten herhalingsafspraken voor de komende 12 weken toevoegen? Bestaande afspraken blijven ongewijzigd."))return;
 const horizon=addDays(now(),84),rows=[],seen=new Set(S.visits.map(v=>v.client_id+"|"+v.service_date));
 for(const c of S.clients.filter(z=>z.active)){
 const list=jobs(c.id).filter(v=>!["cancelled","skipped"].includes(v.status));
 const last=list.at(-1),time=last?start(last):"09:00";let date=last?addDays(last.service_date,7*c.interval_weeks):now();
 let guard=0;while(date<now()&&guard++<100)date=addDays(date,7*c.interval_weeks);
 while(date<=horizon&&rows.length<400&&guard++<125){const key=c.id+"|"+date;if(!seen.has(key)){rows.push({client_id:c.id,service_date:date,start_time:time,duration_minutes:c.duration_minutes,price_eur:c.price_eur});seen.add(key);}date=addDays(date,7*c.interval_weeks);}
 }
 if(!rows.length){message("Alles staat al ingepland voor de komende 12 weken.");return;}
 const {error}=await S.sb.from("glass_visits").insert(rows);if(error)throw error;
 message(rows.length+" bezoeken toegevoegd. Controleer de agenda.");await load();
}
async function deleteClient(id){
 const c=client(id);if(!c)return;
 const n=jobs(id).length;if(!confirm("Klant "+c.name+" verwijderen? Ook "+n+" gekoppelde bezoeken worden definitief verwijderd."))return;
 const {error}=await S.sb.from("glass_clients").delete().eq("id",id).eq("owner_id",S.user.id);if(error)throw error;message("Klant verwijderd.");await load();
}
async function deleteVisit(id){
 const v=S.visits.find(t=>t.id===id);if(!v)return;
 if(!confirm("Bezoek van "+fullLabel(v)+" op "+v.service_date+" verwijderen?"))return;
 const {error}=await S.sb.from("glass_visits").delete().eq("id",id).eq("owner_id",S.user.id);if(error)throw error;message("Bezoek verwijderd.");await load();
}
function routeDay(){
 const rows=dayJobs(S.day).filter(v=>v.status==="planned").map(v=>client(v.client_id)).filter(Boolean).map(c=>address(c)).filter(Boolean);
 if(!rows.length)return message("Geen geplande adressen met een locatie op deze dag.",true);
 const last=rows.at(-1),others=rows.slice(0,-1),url="https://www.google.com/maps/dir/?api=1&travelmode=driving&destination="+encodeURIComponent(last)+(others.length?"&waypoints="+encodeURIComponent(others.slice(0,9).join("|")):"");
 window.open(url,"_blank","noopener,noreferrer");
 if(rows.length>10)message("Google Maps toont maximaal 10 stops in deze route. Splits lange routes op.");
}
function safeCsv(v){let s=String(v??"");if(/^[\s]*[=+\-@]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}
function exportCsv(kind){
 const cols=kind==="clients"?["naam","straat","postcode","plaats","telefoon","e-mail","prijs per beurt","frequentie weken","duur minuten","actief","opmerkingen"]:["datum","starttijd","klant","adres","status","prijs","factuurstatus","opmerkingen"];
 const list=kind==="clients"?S.clients.map(c=>[c.name,c.street,c.postal_code,c.city,c.phone,c.email,c.price_eur,c.interval_weeks,c.duration_minutes,c.active?"ja":"nee",c.notes]):S.visits.map(v=>[v.service_date,start(v),fullLabel(v),address(client(v.client_id)||{}),statuses[v.status],v.price_eur,payLabels[v.payment_status],v.notes]);
 const csv="\uFEFF"+[cols,...list].map(row=>row.map(safeCsv).join(";")).join("\r\n");
 const blob=new Blob([csv],{type:"text/csv;charset=utf-8"}),url=URL.createObjectURL(blob),a=document.createElement("a");
 a.href=url;a.download="glazenwasser-"+kind+"-"+now()+".csv";document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);
 message("CSV geëxporteerd.");
}
async function action(el){
 const op=el.dataset.action,id=el.dataset.id;
 if(op==="close-modal"){$("modal-root").replaceChildren();return;}
 if(op==="change-config"){configForm();return;}
 if(op==="new-client"){clientModal();return;}
 if(op==="edit-client"){clientModal(id);return;}
 if(op==="new-visit"){visitModal(null,null);return;}
 if(op==="plan-client"){visitModal(null,id);return;}
 if(op==="edit-visit"){visitModal(id);return;}
 if(op==="prev-month"||op==="next-month"){S.month=new Date(S.month.getFullYear(),S.month.getMonth()+(op==="prev-month"?-1:1),1);S.day=dateKey(S.month);render();return;}
 if(op==="calendar-today"){S.day=now();S.month=new Date();S.month.setDate(1);render();return;}
 if(op==="select-day"){S.day=id;render();return;}
 if(op==="route-day"){routeDay();return;}
 if(op==="export-clients"||op==="export-visits"){exportCsv(op==="export-clients"?"clients":"visits");return;}
 if(S.busy)return;
 S.busy=true;
 try{
 if(op==="delete-client")await deleteClient(id);
 else if(op==="delete-visit")await deleteVisit(id);
 else if(op==="done-next")await finish(id,true);
 else if(op==="bulk-generate")await bulkGenerate();
 else if(op==="set-payment"){const status=el.dataset.status;if(!payLabels[status])throw Error("Ongeldige factuurstatus");await updateVisit(id,{payment_status:status});message("Factuurstatus aangepast.");await load();}
 else if(op==="refresh"){await load();message("Planning bijgewerkt");}
 }catch(e){message(errText(e),true);}finally{S.busy=false;}
}
document.addEventListener("click",async e=>{
 const target=e.target.closest("[data-page],[data-action]");if(!target)return;
 if(target.dataset.page){navigate(target.dataset.page);return;}
 await action(target);
});
document.addEventListener("input",e=>{
 if(e.target.id!=="list-search")return;
 const pos=e.target.selectionStart;S.search=e.target.value;render();const fresh=$("list-search");if(fresh){fresh.focus();fresh.setSelectionRange(pos,pos);}
});
document.addEventListener("change",e=>{if(e.target.id==="status-filter"){S.status=e.target.value;render();}});
document.addEventListener("submit",async e=>{
 if(!["setup-form","login-form","client-form","visit-form"].includes(e.target.id))return;
 e.preventDefault();if(S.busy)return;
 const f=e.target,btn=f.querySelector('button[type="submit"]');S.busy=true;if(btn)btn.disabled=true;
 try{
 if(f.id==="setup-form"){
 const data=new FormData(f),url=String(data.get("url")||"").trim().replace(/\/$/,""),key=String(data.get("key")||"").trim();
 if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url)||!/^[\w.\-]+$/.test(key)||/service_role|sb_secret_/i.test(key))throw Error("Alleen een geldige Supabase URL en publieke sleutel zijn toegestaan.");
 localStorage.setItem("jar_admin_config_v1",JSON.stringify({url,key}));S.sb=null;await boot();return;
 }
 if(f.id==="login-form"){
 if(!S.sb)throw Error("Verbinding ontbreekt; stel Supabase opnieuw in.");
 const data=new FormData(f),{error,data:auth}=await S.sb.auth.signInWithPassword({email:String(data.get("email")||"").trim(),password:String(data.get("password")||"")});
 if(error)throw error;await authorize(auth.user);return;
 }
 if(f.id==="client-form")await saveClient(f);
 if(f.id==="visit-form")await saveVisit(f);
 }catch(e){const inline=$("form-error");if(inline)inline.textContent=errText(e);else if(f.id==="login-form")loginForm(errText(e));else if(f.id==="setup-form")configForm(errText(e));else message(errText(e),true);}
 finally{S.busy=false;if(btn)btn.disabled=false;}
});
$("logout").addEventListener("click",async()=>{if(!confirm("Uitloggen bij de planner?"))return;await S.sb?.auth.signOut();S.user=null;S.clients=[];S.visits=[];loginForm();});
$("refresh").addEventListener("click",async()=>{if(S.user)await action({dataset:{action:"refresh"}});});
$("menu-toggle").addEventListener("click",()=>$("sidebar").classList.toggle("open"));
$("modal-root").addEventListener("click",e=>{if(e.target.id==="backdrop")$("modal-root").replaceChildren();});
document.addEventListener("keydown",e=>{if(e.key==="Escape"){$("modal-root").replaceChildren();$("sidebar").classList.remove("open");}});
boot();
})();