'use strict';
const $=s=>document.querySelector(s), ce=(tag,text='',cls='')=>{let el=document.createElement(tag);el.textContent=text; if(cls) el.className=cls;return el;};
const cf=new Intl.NumberFormat('cs-CZ');
let reg=null, results={}, current=null, coalAll=[], page=0, filtered=[], state=null, pollTimer=null, requestSeq=0;
const districtLoaded=new Map();
const colors=['#367bc3','#f09e34','#27a69a','#ad6ac4','#d86579','#76953f','#7a8da2','#c08f64','#658ce4','#a0af4d','#d87046','#588a84','#9367a7','#bd7e9b'];
const squish=s=>(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const int=n=>Number(n)||0;
const num=n=>cf.format(int(n));
const labelText=(root,value,cls='')=>root.append(ce('span',value,cls));
const PICK=['České Budějovice','Praha','Praha 10','Čestlice','Deštné v Orlických horách','Brno'];
function createSelector(root,id,text){const b=ce('button',text,'pick');b.type='button';b.addEventListener('click',()=>choose(id));b.dataset.place=id;root.append(b);}
function renderLeft(){
 const presets=$('#presets');presets.replaceChildren();
 for(const name of PICK){let id=reg.presets[name];if(id)createSelector(presets,id,name);}
 const all=Object.values(reg.councils||{}); const pirate=(reg.southBohemiaPirates||[]).map(id=>reg.councils[id]).filter(Boolean);
 $('#pirateCount').textContent=`${pirate.length} zastupitelstev – automatický seznam podle ČSÚ`;
 $('#search').oninput=()=>{
  let q=squish($('#search').value.trim()),root=$('#searchResults');root.replaceChildren();
  if(q.length<2){root.append(ce('p','Zadej alespoň dva znaky.','left-note'));return;}
  const found=all.filter(a=>squish(a.name).includes(q)).slice(0,75);
  if(!found.length)root.append(ce('p','Žádná shoda.','left-note'));
  for(const r of found){let b=ce('button',r.name+' · '+r.id);b.addEventListener('click',()=>choose(r.id));root.append(b);}
 };
 $('#pirateSearch').oninput=()=>drawPirates(pirate);
 drawPirates(pirate);
}
function drawPirates(all){let q=squish($('#pirateSearch').value),items=all.filter(x=>squish(x.name).includes(q)),root=$('#pirateList');root.replaceChildren();
 for(let c of items){let b=ce('button',`${c.name} · ${c.pirateNominated} nomin.`);b.addEventListener('click',()=>choose(c.id));root.append(b);}
 if(!items.length)root.append(ce('p','Žádné odpovídající obce.','left-note'));
}
function choose(id){current=reg.councils[String(id)];if(!current)return;history.replaceState(null,'','#'+encodeURIComponent(id));document.querySelectorAll('.pick').forEach(x=>x.classList.toggle('active',x.dataset.place==id));display();if(window.innerWidth<760)$('#summary').scrollIntoView({behavior:'smooth',block:'start'});}
function display(){if(!current)return;
 const c=current, data=results[c.id];$('#cityName').textContent=c.name;
 const meta=$('#meta');meta.replaceChildren();labelText(meta,`Zastupitelů: ${num(c.seats)}`,'pill');labelText(meta,`Kód: ${c.id}`,'subtle');
 if(c.pirateNominated){labelText(meta,`Nominace Pirátů: ${c.pirateNominated}`,'pill');const ds=ce('details');const summ=ce('summary','Zobrazit nominované kandidáty','subtle');summ.style.cursor='pointer';ds.append(summ);for(let p of c.pirateCandidates||[])ds.append(ce('div',`${p.name} – ${p.party}`,'fineprint'));meta.append(ds);}
 const sm=$('#summary');sm.querySelectorAll('.warning,.info,.error').forEach(n=>n.remove());const info=ce('div','','info');info.style.marginTop='16px';sm.append(info);
 if(!reg.updated){info.textContent='Čeká se na první načtení registrů ČSÚ na GitHubu.';blank();return;}
 if(!data){info.textContent='Pro toto zastupitelstvo ještě nejsou data, případně nebyla úspěšně zpracována první dávka ČSÚ. Zkontroluj čas poslední aktualizace a GitHub Actions.';blank();return;}
 if(data.status!=='ok'){info.className='warning';info.textContent=data.message||'Výsledky zatím nelze spolehlivě přepočítat.';blank();return;}
 if(data.processed!=null&&data.total!=null){const done=100*data.processed/Math.max(1,data.total);info.textContent=`Sečteno ${data.processed} z ${data.total} okrsků (${done.toLocaleString('cs-CZ',{maximumFractionDigits:1})} %). `+(data.complete?'Konečné výsledky za obec.':'Průběžné mandáty vypočtené ze sečtených hlasů – nejde o předpověď.');}
 else info.textContent='Procento sečtených okrsků nebylo v datech rozpoznáno. Mandáty jsou neoficiálním přepočtem dosavadních hlasů.';
 if(data.lotTie){info.className='warning';info.textContent+=' Pozor: shoda podílů pro rozhodující mandát může vyžadovat los!';}
 renderSeats(data);renderCoalitions(data);
}
function blank(){$('#seatsContent').replaceChildren(ce('p','Čeká se na data.','muted'));$('#exclusions').replaceChildren();$('#goal').textContent='';$('#coalitionCount').textContent='';$('#coalitionResults').replaceChildren(ce('p','Zatím nelze vypočítat kombinace.','empty'));$('#more').classList.add('hide');}
function renderSeats(data){
 const area=$('#seatsContent');area.replaceChildren();const total=int(current.seats),seatSum=data.parties.reduce((s,p)=>s+int(p.seats),0),maj=Math.floor(total/2)+1;
 let line=ce('div',`Potřeba pro většinu: ${maj} z ${total} mandátů`,'big');area.append(line);
 if(seatSum<total)area.append(ce('p',`Zatím přiděleno ${seatSum} z ${total} mandátů (např. kvůli malému počtu kandidátů).`,'subtle'));
 let bar=ce('div','','seatbar');bar.setAttribute('aria-label','Graf mandátů');
 const sorted=[...data.parties].sort((a,b)=>b.seats-a.seats || b.votes-a.votes);let idx=0;
 for(const p of sorted){if(!p.seats)continue;const seg=ce('span');seg.style.flex=String(p.seats);seg.style.background=colors[idx++%colors.length];seg.title=`${p.name}: ${p.seats} mandátů`;bar.append(seg);}area.append(bar);
 let table=ce('table');let head=ce('thead');let tr=ce('tr');['Kandidátní listina','Hlasy','Mandáty'].forEach((x,i)=>tr.append(ce('th',x,i?'num':'')));head.append(tr);table.append(head);
 let tb=ce('tbody');for(const p of sorted){tr=ce('tr');tr.append(ce('td',p.name));tr.append(ce('td',num(p.votes),'num'));tr.append(ce('td',num(p.seats),'num'));tb.append(tr);}table.append(tb);let wrap=ce('div','','tablewrap');wrap.append(table);area.append(wrap);
 area.append(ce('p',data.complete?'Mandáty po úplném sečtení (pokud dostupné, převzaté od ČSÚ).':`Neoficiální přepočet ze sečtených hlasů. Uplatněná vstupní hranice: ${data.threshold===null?'bez hranice':data.threshold+' %'}.`,'fineprint'));
}
function setupOptions(data){let root=$('#exclusions'),existing=new Set([...root.querySelectorAll('input:checked')].map(x=>x.value));root.replaceChildren();
 for(const p of data.parties.filter(p=>p.seats>0).sort((a,b)=>b.seats-a.seats)){
  let l=ce('label'),cb=ce('input');cb.type='checkbox';cb.value=p.ballot;cb.checked=existing.has(cb.value);cb.addEventListener('change',()=>refreshCoalitions());l.append(cb,ce('span',p.name+` (${p.seats})`));root.append(l);
 }
}
function renderCoalitions(data){setupOptions(data);refreshCoalitions();}
function refreshCoalitions(){let data=results[current?.id];if(!data||data.status!=='ok')return;
 let excl=new Set([...$('#exclusions input:checked')].map(x=>x.value));let parties=data.parties.filter(p=>p.seats>0&&!excl.has(p.ballot));let seats=current.seats,majority=Math.floor(seats/2)+1;
 $('#goal').textContent=`Většina ${majority} / ${seats}`;
 let max=Math.min(int($('#maxParties').value),parties.length), gap=int($('#gap').value),typ=$('#typeFilter').value;
 let solutions=[];let truncated=false;
 // Velké kandidátní systémy mohou mít obrovské množství kombinací. Je-li >18 stran, použij max. 5 subjektů.
 if(parties.length>18){max=Math.min(max,5);truncated=true;}
 function make(start,selected,sum){
  if(selected.length>=2){let diff=sum-majority;if((sum>=majority||(sum>=majority-gap&&typ!=='majority'&&typ!=='minimal')) && (typ!=='near'||sum<majority) && (typ!=='majority'||sum>=majority)){
   let minimal=selected.every(x=>sum-x.seats<majority);
   if(typ!=='minimal'||minimal)solutions.push({list:[...selected],sum,delta:diff,minimal});
  }}
  if(selected.length>=max)return;
  for(let i=start;i<parties.length;i++)make(i+1,[...selected,parties[i]],sum+parties[i].seats);
 }
 make(0,[],0);
 // Výpis: většiny a skoro-většiny, uvnitř od menšího počtu kandidátek; bez hodnocení politické vhodnosti.
 solutions.sort((a,b)=>b.delta-a.delta || a.list.length-b.list.length || a.sum-b.sum || a.list.map(p=>p.name).join('|').localeCompare(b.list.map(p=>p.name).join('|'),'cs'));
 // Pro rychlé nalezení 'skoro-většin' nezapadnou za obrovské většinové kombinace; dvě sekce.
 coalAll=solutions;page=0;filtered=solutions;
 const nMaj=solutions.filter(a=>a.delta>=0).length,nNear=solutions.length-nMaj;
 $('#coalitionCount').textContent=`${nMaj} většinových, ${nNear} téměř většinových kombinací`+(truncated?' · u více než 18 subjektů omezeno na nejvýše 5 stran':'');
 showCoalitions();
}
function showCoalitions(){const root=$('#coalitionResults');if(page===0)root.replaceChildren();let before=page*100,to=Math.min(before+100,filtered.length);
 if(!filtered.length&&page===0)root.append(ce('div','Pro tato nastavení nejsou žádné kombinace.','empty'));
 for(let i=before;i<to;i++){
  let s=filtered[i],row=ce('div','','coalition'),names=ce('div','','coal-names'),score=ce('div','','outcome '+(s.delta>=0?'ok':'near'));
  for(let j=0;j<s.list.length;j++){if(j)names.append(ce('span','+'));names.append(ce('span',s.list[j].name));}
  score.append(ce('span',`${s.sum} / ${current.seats}`));score.append(ce('small',s.delta>=0?'většina'+(s.minimal?' · minimální':''):`chybí ${-s.delta}`));row.append(names,score);root.append(row);
 }
 $('#more').classList.toggle('hide',to>=filtered.length);page++;
}
for(let id of ['maxParties','typeFilter','gap'])$(('#'+id)).addEventListener('change',refreshCoalitions);
$('#more').addEventListener('click',showCoalitions);
// Registry se načtou jednou za návštěvu. Výsledky jsou rozdělené podle okresů.
async function loadDistrict(district, force=false){
 const id=String(district), revision=state?.lastBatch ?? 0;
 if(!force && districtLoaded.get(id)===revision)return;
 try{
  const url='./data/okresy/'+encodeURIComponent(id)+'.json?v='+revision;
  const response=await fetch(url,{cache:'no-store'});
  if(response.status===404){districtLoaded.set(id,revision);return;}
  if(!response.ok)throw new Error('HTTP '+response.status);
  const data=await response.json();
  Object.assign(results,data.results||{});
  districtLoaded.set(id,revision);
 }catch(error){
  $('#status').textContent='Nepodařilo se načíst výsledky okresu: '+error.message;
 }
}
function updateStamp(){
 const t=state?.updated;
 $('#status').textContent=t
  ?`Dávka ${state.lastBatch} · aktualizace ${new Date(t).toLocaleString('cs-CZ',{dateStyle:'short',timeStyle:'short'})}`
  :'Registry načteny · čeká se na první dávku ČSÚ';
}
async function initialize(){
 try{
  const response=await fetch('./data/registr.json?v=2',{cache:'no-store'});
  if(!response.ok)throw new Error('Registr kandidátek není dostupný.');
  reg=await response.json();
  if(!Object.keys(reg.councils||{}).length){
   $('#status').textContent='Čeká se na první import kandidátek';
   $('#cityName').textContent='Nejprve spusť aktualizaci na GitHubu';
   return;
  }
  renderLeft();
  await checkUpdates(true);
  const hash=decodeURIComponent(location.hash.slice(1));
  const id=(reg.councils?.[hash]?hash:reg.presets?.['České Budějovice']);
  if(id)await choose(id);
 }catch(err){
  $('#status').textContent='Chyba: '+err.message;
 }
}
async function checkUpdates(first=false){
 try{
  const res=await fetch('./data/state.json?time='+Date.now(),{cache:'no-store'});
  if(!res.ok)throw new Error('HTTP '+res.status);
  const newer=await res.json();
  const changed=!state || Number(newer.lastBatch)!==Number(state.lastBatch);
  state=newer;updateStamp();
  if(changed && !first && current){
   await loadDistrict(current.district,true);
   display();
  }
 }catch(err){$('#status').textContent='Kontrola aktualizace selhala: '+err.message;}
}
function schedulePolling(){
 if(pollTimer)clearInterval(pollTimer);
 const minutes=Number($('#pollInterval').value)||2;
 try{localStorage.setItem('volebniapp_poll_minutes',String(minutes));}catch{}
 pollTimer=setInterval(()=>{if(reg)checkUpdates();},minutes*60000);
}
$('#pollInterval').addEventListener('change',schedulePolling);
$('#refreshNow').addEventListener('click',()=>checkUpdates());
try{const v=localStorage.getItem('volebniapp_poll_minutes');if(['1','2','5','10'].includes(v))$('#pollInterval').value=v;}catch{}
schedulePolling();initialize();
