'use strict';
const $=s=>document.querySelector(s), ce=(tag,text='',cls='')=>{let el=document.createElement(tag);el.textContent=text; if(cls) el.className=cls;return el;};
const cf=new Intl.NumberFormat('cs-CZ');
let reg=null, results={}, current=null, coalAll=[], page=0, filtered=[], state=null, pollTimer=null, requestSeq=0;
// Veřejný rychlý zdroj – stejný pro všechny návštěvníky stránky.
const LIVE_URL='https://script.google.com/macros/s/AKfycbzLT_4LDSY5WBHLDX_CQRyn3W8K2YS1YmGMRD4D3s9CLx88Yr3bKpq9UsVrbqETyBa6/exec';
const liveUrl=LIVE_URL;
const liveInFlight=new Set();
const liveResults=new Map();
const districtLoaded=new Map();
const colors=['#367bc3','#f09e34','#27a69a','#ad6ac4','#d86579','#76953f','#7a8da2','#c08f64','#658ce4','#a0af4d','#d87046','#588a84','#9367a7','#bd7e9b'];
const squish=s=>(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const int=n=>Number(n)||0;
const num=n=>cf.format(int(n));
const labelText=(root,value,cls='')=>root.append(ce('span',value,cls));
// Rychlá data mají přednost před zpožděnými okresními soubory z GitHubu.
const resultFor=id=>{
 const live=liveResults.get(String(id))?.result, cached=results[String(id)];
 if(!live)return cached;
 if(!cached?.complete || !live.complete || cached.status!=='ok')return live;
 return {...live,parties:live.parties.map(p=>{
  if(p.elected?.length)return p;
  const saved=cached.parties?.find(x=>x.ballot===p.ballot && x.votes===p.votes && x.seats===p.seats);
  return saved?.elected?.length?{...p,elected:saved.elected}:p;
 })};
};
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
async function choose(id){
 const selected=reg.councils[String(id)];
 if(!selected)return;
 current=selected;
 const sequence=++requestSeq;
 history.replaceState(null,'','#'+encodeURIComponent(id));
 document.querySelectorAll('.pick').forEach(x=>x.classList.toggle('active',x.dataset.place==id));
 $('#cityName').textContent=selected.name;
 $('#seatsContent').replaceChildren(ce('p','Načítám výsledky obce…','muted'));
 await loadDistrict(selected.district);
 // Rychlé přepínání mezi obcemi nesmí vykreslit starý výběr.
 if(sequence===requestSeq && current?.id===selected.id) {
  display();
  if(liveUrl)void loadLiveForCurrent();
 }
 if(window.innerWidth<760)$('#summary').scrollIntoView({behavior:'smooth',block:'start'});
}
function display(){if(!current)return;
 const c=current, data=resultFor(c.id);$('#cityName').textContent=c.name;
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
 if(seatSum<total)area.append(ce('p',data.complete?`Obsazeno ${seatSum} z ${total} mandátů. Zbývající ${total-seatSum} nebyl${total-seatSum===1?'':'y'} přidělen${total-seatSum===1?'':'y'} (např. kvůli počtu kandidátů).`:`Průběžně přiděleno ${seatSum} z ${total} mandátů.`, 'subtle'));
 let bar=ce('div','','seatbar');bar.setAttribute('aria-label','Graf mandátů');
 const sorted=[...data.parties].sort((a,b)=>b.seats-a.seats || b.votes-a.votes);let idx=0;
 for(const p of sorted){if(!p.seats)continue;const seg=ce('span');seg.style.flex=String(p.seats);seg.style.background=colors[idx++%colors.length];seg.title=`${p.name}: ${p.seats} mandátů`;bar.append(seg);}area.append(bar);
 let table=ce('table');let head=ce('thead');let tr=ce('tr');['Kandidátní listina','Hlasy','Mandáty'].forEach((x,i)=>tr.append(ce('th',x,i?'num':'')));head.append(tr);table.append(head);
 let tb=ce('tbody');for(const p of sorted){tr=ce('tr');tr.append(ce('td',p.name));tr.append(ce('td',num(p.votes),'num'));tr.append(ce('td',num(p.seats),'num'));tb.append(tr);}table.append(tb);let wrap=ce('div','','tablewrap');wrap.append(table);area.append(wrap);
 renderElected(area,data,sorted);
 area.append(ce('p',data.complete?'Mandáty po úplném sečtení (pokud dostupné, převzaté od ČSÚ).':`Neoficiální přepočet ze sečtených hlasů. Uplatněná vstupní hranice: ${data.threshold===null?'bez hranice':data.threshold+' %'}.`,'fineprint'));
}

// Jednotlivé zvolené osoby: jména přebíráme z oficiálního XML ČSÚ.
// Za neúplného sčítání v něm nejsou k dispozici hlasy všech kandidátů,
// proto žádná konkrétní jména neodhadujeme pouze z pořadí na kandidátce.
function renderElected(area,data,sorted){
 const section=ce('section','','elected-section');
 section.append(ce('h4','Kdo získal mandát – podle kandidátek'));
 if(!data.complete){
  section.append(ce('p','Zastupitelé zatím nejsou jmenovitě určeni. ČSÚ zveřejní seznam zvolených osob až po dopočítání zastupitelstva.','fineprint'));
  area.append(section);return;
 }
 const listed=sorted.filter(p=>p.seats>0);
 if(!listed.length)return;
 const withNames=listed.filter(p=>Array.isArray(p.elected) && p.elected.length>0);
 if(!withNames.length){
  section.append(ce('p','Oficiální jmenné výsledky zatím nejsou v načtených datech dostupné. Po aktualizaci zdroje se doplní automaticky.','fineprint'));
  area.append(section);return;
 }
 for(const party of listed){
  const details=ce('details','','elected-party');
  const names=Array.isArray(party.elected)?party.elected:[];
  details.append(ce('summary',`${party.name} · ${names.length} jmen z ${party.seats} mandátů`));
  if(party.seats<=10)details.open=true;
  if(names.length){
   const list=ce('ol','','elected-names');
   for(const person of names){
    const name=String(person.name||'').trim();
    if(!name)continue;
    const label=name+(person.votes!=null?` · ${num(person.votes)} hlasů`:'');
    list.append(ce('li',label));
   }
   details.append(list);
  }else details.append(ce('p','Jména zatím nejsou v dostupných údajích ČSÚ.','fineprint'));
  section.append(details);
 }
 area.append(section);
}
function setupOptions(data){let root=$('#exclusions'),existing=new Set([...root.querySelectorAll('input:checked')].map(x=>x.value));root.replaceChildren();
 for(const p of data.parties.filter(p=>p.seats>0).sort((a,b)=>b.seats-a.seats)){
  let l=ce('label'),cb=ce('input');cb.type='checkbox';cb.value=p.ballot;cb.checked=existing.has(cb.value);cb.addEventListener('change',()=>refreshCoalitions());l.append(cb,ce('span',p.name+` (${p.seats})`));root.append(l);
 }
}
function renderCoalitions(data){setupOptions(data);refreshCoalitions();}
// Aritmetické kombinace. Zahrnuje i jedinou kandidátku se samostatnou většinou.
function calculateCoalitions(parties,majority,maxParties,gap,typeFilter){
 const max=Math.min(Math.max(1,maxParties),parties.length);
 const solutions=[];
 function recurse(start,picked,sum){
  if(picked.length){
   const delta=sum-majority;
   const isMajority=delta>=0;
   const near=!isMajority && -delta<=gap;
   const minimal=isMajority && picked.every(p=>sum-p.seats<majority);
   if((isMajority||near) &&
     (typeFilter!=='majority'||isMajority) &&
     (typeFilter!=='near'||near) &&
     (typeFilter!=='minimal'||minimal)){
    solutions.push({list:[...picked],sum,delta,minimal});
   }
  }
  if(picked.length>=max)return;
  for(let i=start;i<parties.length;i++)recurse(i+1,[...picked,parties[i]],sum+parties[i].seats);
 }
 recurse(0,[],0);
 solutions.sort((a,b)=>b.delta-a.delta || a.list.length-b.list.length || a.sum-b.sum ||
   a.list.map(p=>p.name).join('|').localeCompare(b.list.map(p=>p.name).join('|'),'cs'));
 return solutions;
}
function refreshCoalitions(){
 let data=resultFor(current?.id);if(!data||data.status!=='ok')return;
 const excl=new Set([...document.querySelectorAll('#exclusions input:checked')].map(x=>x.value));
 const parties=data.parties.filter(p=>p.seats>0&&!excl.has(p.ballot));
 const seats=current.seats,majority=Math.floor(seats/2)+1;
 $('#goal').textContent=`Většina ${majority} / ${seats}`;
 let max=Math.min(int($('#maxParties').value),parties.length),gap=int($('#gap').value),typ=$('#typeFilter').value;
 let truncated=false;
 if(parties.length>18){max=Math.min(max,5);truncated=true;}
 const solutions=calculateCoalitions(parties,majority,max,gap,typ);
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
  score.append(ce('span',`${s.sum} / ${current.seats}`));score.append(ce('small',s.delta>=0?(s.list.length===1?'samostatná většina':'většina'+(s.minimal?' · minimální':'')):`chybí ${-s.delta}`));row.append(names,score);root.append(row);
 }
 $('#more').classList.toggle('hide',to>=filtered.length);page++;
}
for(let id of ['maxParties','typeFilter','gap'])$(('#'+id)).addEventListener('change',refreshCoalitions);
$('#more').addEventListener('click',showCoalitions);

// Prevod aktualniho stavoveho XML jedne obce na stejna data jako okresni parser.
// Kandidatky i pocet kandidatu bereme z ulozeneho registru ČSÚ.
function convertLiveData(raw, council){
 if(!raw || raw.ok!==true || String(raw.code)!==String(council.id))throw Error(raw?.error||'ČSÚ nevrátilo údaje o požadované obci');
 if(council.wards)return {status:'warded',message:'Zastupitelstvo má více volebních obvodů, průběžný přepočet není podporován.'};
 const ballots=(council.ballots||[]).filter(p=>String(p.ward)==='1');
 const ballotMap=new Map(ballots.map(p=>[String(p.ballot),p]));
 const items=raw.parties||[];
 if(!items.length || items.length!==ballots.length || new Set(items.map(p=>String(p.ballot))).size!==items.length)
  throw Error('Výsledky se neshodují s registrem kandidátek; ponechávám poslední uložená data.');
 const parties=items.map(p=>{
  const b=ballotMap.get(String(p.ballot));
  if(!b || !Number.isSafeInteger(Number(p.votes)) || Number(p.votes)<0)throw Error('Neodpovídající číslo kandidátky nebo hlasy');
  return {ballot:String(p.ballot),name:b.name,votes:Number(p.votes),officialSeats:p.officialSeats,
    candidates:Number(b.candidates)||0, elected:Array.isArray(p.elected)?p.elected:[]};
 });
 const {seats,threshold,tie}=liveDHondt(parties,Number(council.seats));
 const official=parties.reduce((sum,p)=>sum+(Number(p.officialSeats)||0),0);
 const allOfficial=parties.every(p=>p.officialSeats!=null);
 const complete=Boolean(raw.complete || raw.total!=null && raw.processed!=null && raw.processed===raw.total);
 for(const p of parties)p.seats=(complete && allOfficial && official===Number(council.seats))?Number(p.officialSeats):Number(seats[p.ballot]||0);
 return {status:'ok',total:raw.total,processed:raw.processed,complete,threshold,lotTie:tie,parties};
}
function liveDHondt(parties,seats){
 const total=parties.reduce((sum,p)=>sum+p.votes,0),counts={};
 for(const p of parties)counts[p.ballot]=0;
 if(!total || seats<=0)return {seats:counts,threshold:null,tie:false};
 const valid=parties.filter(p=>p.candidates>0 && p.votes>0);
 if(!valid.length)return {seats:counts,threshold:null,tie:false};
 let eligible=valid,threshold=null;
 if(parties.length>1){
  threshold=0;
  for(let t=5;t>=0;t--){
   const cand=valid.filter(p=>p.votes*100*seats>=t*total*Math.min(p.candidates,seats));
   const need=Math.min(seats,Math.max(Math.floor(seats/2)+1,5));
   if(cand.length>=2 && cand.reduce((s,p)=>s+Math.min(p.candidates,seats),0)>=need){
    eligible=cand;threshold=t;break;
   }
  }
 }
 const quot=[];
 for(const p of eligible)for(let d=1;d<=Math.min(seats,p.candidates);d++)quot.push({votes:p.votes,divisor:d,ballot:p.ballot});
 quot.sort((a,b)=>{
  const diff=b.votes*a.divisor-a.votes*b.divisor;
  return diff || b.votes-a.votes;
 });
 const selected=quot.slice(0,seats);
 for(const p of selected)counts[p.ballot]++;
 const tie=quot.length>seats && selected.length>0 &&
  quot[seats].votes*selected[selected.length-1].divisor===selected[selected.length-1].votes*quot[seats].divisor &&
  quot[seats].votes===selected[selected.length-1].votes;
 return {seats:counts,threshold,tie};
}
// Google Apps Script poskytuje verejny JSONP; kazdy dotaz stahuje pouze jednu obec.
// U cloveka mimo nasi domenu se nepredava zadna soukroma informace.
function jsonp(url,code){
 return new Promise((resolve,reject)=>{
  const cb='volebniLive_'+Date.now()+'_'+Math.floor(Math.random()*1000000);
  const script=document.createElement('script');
  let finished=false;
  const finish=(error,value)=>{
   if(finished)return;finished=true;clearTimeout(timer);delete window[cb];script.remove();
   error?reject(error):resolve(value);
  };
  const timer=setTimeout(()=>finish(Error('Vypršel čas čekání na Google Apps Script')),20000);
  window[cb]=value=>finish(null,value);
  script.onerror=()=>finish(Error('Není dostupná služba Google Apps Script'));
  script.src=url+(url.includes('?')?'&':'?')+'code='+encodeURIComponent(code)+'&callback='+encodeURIComponent(cb)+'&t='+Date.now();
  document.head.append(script);
 });
}
async function loadLiveForCurrent(){
 if(!liveUrl || !current)return;
 const selectedId=String(current.id);
 if(liveInFlight.has(selectedId))return;
 liveInFlight.add(selectedId);
 try{
  const raw=await jsonp(liveUrl,selectedId);
  const council=reg?.councils?.[selectedId];
  if(!council)return;
  const value=convertLiveData(raw,council);
  if(value.status!=='ok')throw Error(value.message);
  liveResults.set(selectedId,{result:value,published:raw.published,fetched:new Date()});
  if(current?.id===selectedId){
   display();
   const source=raw.published?' · ČSÚ '+raw.published.replace('T',' '):'';
   $('#liveStatus').textContent='Rychlý režim funguje'+source+'; kontrola '+new Date().toLocaleTimeString('cs-CZ');
   $('#status').textContent='Živá obec z ČSÚ'+(raw.published?' · '+raw.published.replace('T',' '):'');
  }
 }catch(error){
  $('#liveStatus').textContent='Rychlý režim: '+error.message+' · GitHub zůstává záložním zdrojem.';
 }finally{liveInFlight.delete(selectedId);}
}
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
 const seconds=Number($('#pollInterval').value)||30;
 try{localStorage.setItem('volebniapp_poll_seconds',String(seconds));}catch{}
 pollTimer=setInterval(async()=>{
  if(!reg)return;
  await checkUpdates();
  if(liveUrl)await loadLiveForCurrent();
 },seconds*1000);
}
$('#pollInterval').addEventListener('change',schedulePolling);
$('#refreshNow').addEventListener('click',async()=>{
 await checkUpdates();
 if(current){await loadDistrict(current.district,true);display();}
 if(liveUrl)await loadLiveForCurrent();
});
try{const v=localStorage.getItem('volebniapp_poll_seconds');if(['15','30','60','120','300','600'].includes(v))$('#pollInterval').value=v;}catch{}
schedulePolling();initialize();
