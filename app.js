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
// Jmenné kandidátky se načítají po okresech až při rozkliknutí strany.
const candidateRosterCache=new Map(), candidateRosterPending=new Map();
const expandedBallots=new Set();
const candidateVoteCache=new Map(), candidateVotePending=new Map();
const colors=['#367bc3','#f09e34','#27a69a','#ad6ac4','#d86579','#76953f','#7a8da2','#c08f64','#658ce4','#a0af4d','#d87046','#588a84','#9367a7','#bd7e9b'];
const squish=s=>(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const int=n=>Number(n)||0;
const num=n=>cf.format(int(n));
const labelText=(root,value,cls='')=>root.append(ce('span',value,cls));
// Všude zobrazujeme zkrácené štítky, ale původní název ČSÚ zachováváme
// v titulku a ve volitelném přepínači pro úplné názvy.
let shortNames = new Map();
function abbreviatePartyName(full){
 let s=String(full||'').replace(/\s+/g,' ').trim();
 const aliases=[
  [/^Česká pirátská strana$/i,'Piráti'],
  [/^Občanská demokratická strana$/i,'ODS'],
  [/^Starostové a nezávislí$/i,'STAN'],
  [/^Křesťanská a demokratická unie\s*[-–]\s*Československá strana lidová$/i,'KDU-ČSL'],
  [/^Komunistická strana Čech a Moravy$/i,'KSČM'],
  [/^Sociální demokracie$/i,'SOCDEM'],
 ];
 for(const [pattern,short] of aliases)if(pattern.test(s))return short;
 s=s.replace(/^Sdružení nezávislých kandidátů(?=$|[\s:–—-])[\s:–—-]*/i,'Nezávislí – ')
    .replace(/^Nezávislí\s+[–-]\s+(za|pro)\s+/i,'Nezávislí $1 ')
    .replace(/^Nezávislí kandidáti\b/i,'Nezávislí');
 const limit=45;
 if(s.length>limit){
  let at=s.lastIndexOf(' ',limit-1);
  if(at<Math.floor(limit/2))at=limit-1;
  s=s.slice(0,at).replace(/[\s,;:–—-]+$/,'')+'…';
 }
 return s;
}
function preparePartyLabels(parties){
 const names=parties.map(p=>({ballot:String(p.ballot),short:abbreviatePartyName(p.name)}));
 const counts=new Map();
 for(const p of names)counts.set(p.short,(counts.get(p.short)||0)+1);
 shortNames=new Map(names.map(p=>[p.ballot,counts.get(p.short)>1?`${p.short} (č. ${p.ballot})`:p.short]));
}
function partyLabel(p){
 return $('#fullNames').checked?String(p.name||''):shortNames.get(String(p.ballot))||abbreviatePartyName(p.name);
}
function fullNameTitle(node,p){node.title=String(p.name||'');return node;}

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
 expandedBallots.clear();
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
 preparePartyLabels(data.parties);
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
 let tb=ce('tbody');
 for(const p of sorted){
  const key=String(current.id)+'/'+String(p.ballot);
  const open=expandedBallots.has(key);
  tr=ce('tr');
  const partyCell=ce('td');
  const partyButton=fullNameTitle(ce('button',partyLabel(p),'candidate-toggle'),p);
  partyButton.type='button';
  partyButton.setAttribute('aria-expanded',String(open));
  partyButton.setAttribute('aria-label','Zobrazit kandidáty: '+p.name);
  partyButton.prepend(ce('span',open?'▾':'▸','candidate-arrow'));
  const detailRow=ce('tr','','candidate-detail-row');detailRow.hidden=!open;
  const detailCell=ce('td');detailCell.colSpan=3;
  const content=ce('div','','candidate-content');detailCell.append(content);detailRow.append(detailCell);
  partyButton.addEventListener('click',()=>{
   const next=!expandedBallots.has(key);
   if(next)expandedBallots.add(key);else expandedBallots.delete(key);
   detailRow.hidden=!next;
   partyButton.setAttribute('aria-expanded',String(next));
   partyButton.querySelector('.candidate-arrow').textContent=next?'▾':'▸';
   if(next)void populateCandidates(content,p,data,current);
  });
  partyCell.append(partyButton);tr.append(partyCell);
  tr.append(ce('td',num(p.votes),'num'));tr.append(ce('td',num(p.seats),'num'));
  tb.append(tr,detailRow);
  if(open)void populateCandidates(content,p,data,current);
 }
 table.append(tb);let wrap=ce('div','','tablewrap');wrap.append(table);area.append(wrap);
 area.append(ce('p',data.complete?'Mandáty po úplném sečtení (pokud dostupné, převzaté od ČSÚ).':`Neoficiální přepočet ze sečtených hlasů. Uplatněná vstupní hranice: ${data.threshold===null?'bez hranice':data.threshold+' %'}.`,'fineprint'));
}

// Jmenné kandidátky jsou statické; není nutné je stahovat každých 15–30 sekund.
async function loadCandidateRoster(district){
 const key=String(district);
 if(candidateRosterCache.has(key))return candidateRosterCache.get(key);
 if(candidateRosterPending.has(key))return candidateRosterPending.get(key);
 const work=(async()=>{
  try{
   const response=await fetch('./data/kandidati/'+encodeURIComponent(key)+'.json?v=1',{cache:'no-store'});
   if(response.status===404)return null;
   if(!response.ok)throw Error('HTTP '+response.status);
   const parsed=await response.json();
   return parsed?.councils||null;
  }catch(err){console.warn('Jmenné kandidátky:',err);return null;}
 })();
 candidateRosterPending.set(key,work);
 try{const data=await work;if(data)candidateRosterCache.set(key,data);return data;}
 finally{candidateRosterPending.delete(key);}
}

// Hlasy jednotlivých kandidátů se načítají nezávisle při rozkliknutí.
// V ČB je poskytuje veřejný nezávislý přehled přes existující Google Apps Script.
// Ostatní obce zatím nemají ověřený zdroj průběžných osobních hlasů.
async function loadCandidateVotes(council,party){
 if(String(council.id)!=='544256')return null;
 const key=String(council.id)+'/'+String(party.ballot);
 const cached=candidateVoteCache.get(key);
 if(cached && Date.now()-cached.time<25000)return cached.data;
 if(candidateVotePending.has(key))return candidateVotePending.get(key);
 const pending=(async()=>{
  const raw=await jsonp(liveUrl,council.id,{mode:'candidates',party:String(party.ballot)});
  if(!raw || raw.ok!==true || String(raw.code)!==String(council.id) ||
    String(raw.party)!==String(Number(party.ballot)))throw Error(raw?.error||'Zdroj kandidátských hlasů není dostupný');
  if(!Array.isArray(raw.candidates)||!raw.candidates.length ||
     raw.candidates.some(k=>!Number.isSafeInteger(k.order)||!Number.isSafeInteger(k.votes)))
    throw Error('Chybějí platné průběžné hlasy kandidátů');
  const sum=raw.candidates.reduce((v,k)=>v+k.votes,0);
  if(sum!==Number(raw.votes))throw Error('Nesouhlasí součet hlasů kandidátů');
  candidateVoteCache.set(key,{time:Date.now(),data:raw});
  return raw;
 })();
 candidateVotePending.set(key,pending);
 try{return await pending;}finally{candidateVotePending.delete(key);}
}

function calculateCandidateRanking(people, seats){
 if(!Array.isArray(people)||!people.length)throw Error('Chybějící kandidáti');
 const votes=people.reduce((s,p)=>s+p.votes,0);
 const averageFloor=Math.floor(votes/people.length);
 // § 45 odst. 4 zákona 491/2001 Sb.: nejméně 110 % celého průměru.
 const promoted=people.filter(p=>10*p.votes>=11*averageFloor)
   .sort((a,b)=>b.votes-a.votes || a.order-b.order);
 const others=people.filter(p=>10*p.votes<11*averageFloor).sort((a,b)=>a.order-b.order);
 const ranked=[...promoted,...others];
 return {averageFloor,threshold:Math.ceil(averageFloor*11/10),totalVotes:votes,
    ranked:ranked.map((p,i)=>({...p,rank:i+1,promoted:10*p.votes>=11*averageFloor,
      shift:i+1<p.order,elected:i<seats}))};
}

function renderCandidateRanking(root,raw,party,data){
 const ranked=calculateCandidateRanking(raw.candidates,int(party.seats));
 root.append(ce('h4',data.complete?'Pořadí kandidátů podle hlasů':'Průběžný přepočet pořadí kandidátů','candidate-heading'));
 root.append(ce('p',`Osobní hlasy: ${num(ranked.totalVotes)} · průměr zaokrouhlený dolů: ${num(ranked.averageFloor)} · pro přednostní postup nejméně ${num(ranked.threshold)} hlasů.`, 'fineprint'));
 if(Number(party.votes)!==ranked.totalVotes)
  root.append(ce('p',`Pozor: data o stranách (${num(party.votes)}) a osobních hlasech (${num(ranked.totalVotes)}) pocházejí z různých časů. Pořadí je vypočteno pouze z navzájem souhlasících osobních hlasů.`, 'candidate-caution'));
 root.append(ce('p',data.complete ? `Mandáty kandidátky: ${int(party.seats)}. Výpočet pořadí z osobních hlasů; oficiálně zvolení se ověřují podle ČSÚ. Zdroj osobních hlasů: ${raw.source}.` : `Průběžně získává ${int(party.seats)} mandátů. Toto pořadí není definitivní, zbývající okrsky ho mohou změnit. Zdroj osobních hlasů: ${raw.source}.`, 'fineprint'));
 const ol=ce('ol','','candidate-list candidate-ranking');
 for(const p of ranked.ranked){
  const label=`${p.name} · ${num(p.votes)} hlasů · původně č. ${p.order}`;
  const li=ce('li',label);
  li.value=p.rank;
  li.className=p.elected?'on-ballot-front':'';
  if(p.promoted)li.append(ce('span',p.shift?' · přeskakuje':' · nad 110 %','candidate-status'));
  if(p.elected)li.append(ce('span',' · mandát (výpočet)','candidate-status'));
  ol.append(li);
 }
 root.append(ol);
 const link=ce('a','Zdrojová tabulka kandidátů ↗','fineprint');link.href=raw.sourceUrl;link.target='_blank';link.rel='noopener';root.append(link);
}

async function populateCandidates(root,party,data,council){
 if(!council)return;
 root.replaceChildren(ce('p','Načítám jmenný seznam kandidátů…','fineprint'));
 let livePersonVotes=null, livePersonalError=null;
 if(String(council.id)==='544256'){
  try{livePersonVotes=await loadCandidateVotes(council,party);}
  catch(err){livePersonalError=err.message;}
 }
 const rows=livePersonVotes?null:await loadCandidateRoster(council.district);
 // Při přepnutí obce nebo pravidelné aktualizaci už nepřepisovat starý panel.
 if(!root.isConnected || current?.id!==council.id)return;
 root.replaceChildren();
 const roster=rows?.[String(council.id)]?.[String(party.ballot)]||[];
 const elected=Array.isArray(party.elected)?party.elected.filter(x=>String(x.name||'').trim()):[];
 const n=int(party.seats);
 if(livePersonVotes){renderCandidateRanking(root,livePersonVotes,party,data);return;}
 if(livePersonalError)root.append(ce('p','Živé osobní hlasy se nepodařilo načíst: '+livePersonalError,'candidate-caution'));
 if(data.complete && elected.length){
  root.append(ce('h4',`Oficiálně zvolení (${elected.length} z ${n} mandátů)`, 'candidate-heading'));
  const ol=ce('ol','','candidate-list');
  for(const person of elected){
   const label=person.name+(person.votes==null?'':` · ${num(person.votes)} hlasů`);
   ol.append(ce('li',label));
  }
  root.append(ol);
  if(elected.length!==n)root.append(ce('p','Počet jmen se neshoduje s počtem mandátů. Zkontroluj aktuálnost dat ČSÚ.','warning'));
  if(roster.length){
   const all=ce('details','','candidate-all');all.append(ce('summary','Celá kandidátní listina ('+roster.length+' osob)'));
   const everyone=ce('ol','','candidate-list');
   for(const c of roster)everyone.append(ce('li',c.name));
   all.append(everyone);root.append(all);
  }
  return;
 }
 if(data.complete && n===0){
  root.append(ce('p','Kandidátka nezískala mandát.','fineprint'));
 }else if(data.complete){
  root.append(ce('p',`Mandátů: ${n}. Jména oficiálně zvolených zatím nejsou v dostupném výsledku ČSÚ. Níže je pouze původní pořadí listiny.`, 'candidate-caution'));
 }else{
  root.append(ce('p',`Průběžný přepočet přiděluje této kandidátce ${n} mandátů. Jména zatím nelze spolehlivě určit: pro tuto obec zatím nejsou napojené ověřené osobní hlasy kandidátů. Ti mohou přednostně přeskočit pořadí.`, 'candidate-caution'));
 }
 if(!roster.length){
  root.append(ce('p','Jmenný registr ještě není zveřejněn. Po prvním načtení kandidátek v GitHub Actions se objeví automaticky.','fineprint'));
  return;
 }
 root.append(ce('h4','Kandidáti v původním pořadí na listině','candidate-heading'));
 const ol=ce('ol','','candidate-list');
 for(const person of roster){
  const li=ce('li',person.name);
  li.value=Number(person.order);
  if(!data.complete && n>0 && Number(person.order)<=n){
   li.className='on-ballot-front';
   li.title='V pořadí kandidátní listiny do hranice počtu mandátů; nejde o určení zvolení.';
  }
  ol.append(li);
 }
 root.append(ol);
 if(!data.complete && n>0)root.append(ce('p',`Tučně vyznačených prvních ${n} míst je pouze orientačních podle původního pořadí, nikoli výpočtem osob se získaným mandátem.`, 'fineprint'));
}

function setupOptions(data){let root=$('#exclusions'),existing=new Set([...root.querySelectorAll('input:checked')].map(x=>x.value));root.replaceChildren();
 for(const p of data.parties.filter(p=>p.seats>0).sort((a,b)=>b.seats-a.seats)){
  let l=ce('label'),cb=ce('input');cb.type='checkbox';cb.value=p.ballot;cb.checked=existing.has(cb.value);cb.addEventListener('change',()=>refreshCoalitions());l.append(cb,fullNameTitle(ce('span',partyLabel(p)+` (${p.seats})`),p));root.append(l);
 }
}
function renderCoalitions(data){setupOptions(data);refreshCoalitions();}
// Aritmetické kombinace. Zahrnuje i jedinou kandidátku se samostatnou většinou.
function calculateCoalitions(parties,majority,maxParties,gap,typeFilter,minimalOnly=false){
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
     (typeFilter!=='minimal'||minimal) &&
     (!minimalOnly||!isMajority||minimal)){
    solutions.push({list:[...picked],sum,delta,minimal});
   }
   // Pokud už máme většinu, žádný její nadmnožinový výběr
   // nemůže být minimální vítěznou koalicí.
   if(isMajority && (minimalOnly || typeFilter==='minimal' || typeFilter==='near'))return;
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
 const solutions=calculateCoalitions(parties,majority,max,gap,typ,$('#minimalOnly').checked);
 coalAll=solutions;page=0;filtered=solutions;
 const nMaj=solutions.filter(a=>a.delta>=0).length,nNear=solutions.length-nMaj;
 $('#coalitionCount').textContent=`${nMaj} většinových, ${nNear} téměř většinových kombinací`+($('#minimalOnly').checked?' · pouze minimální většiny':'')+(truncated?' · u více než 18 subjektů omezeno na nejvýše 5 stran':'');
 showCoalitions();
}
function showCoalitions(){const root=$('#coalitionResults');if(page===0)root.replaceChildren();let before=page*100,to=Math.min(before+100,filtered.length);
 if(!filtered.length&&page===0)root.append(ce('div','Pro tato nastavení nejsou žádné kombinace.','empty'));
 for(let i=before;i<to;i++){
  let s=filtered[i],row=ce('div','','coalition'),names=ce('div','','coal-names'),score=ce('div','','outcome '+(s.delta>=0?'ok':'near'));
  for(let j=0;j<s.list.length;j++){if(j)names.append(ce('span','+'));names.append(fullNameTitle(ce('span',partyLabel(s.list[j])),s.list[j]));}
  score.append(ce('span',`${s.sum} / ${current.seats}`));score.append(ce('small',s.delta>=0?(s.list.length===1?'samostatná většina':'většina'+(s.minimal?' · minimální':'')):`chybí ${-s.delta}`));row.append(names,score);root.append(row);
 }
 $('#more').classList.toggle('hide',to>=filtered.length);page++;
}
for(let id of ['maxParties','typeFilter','gap','minimalOnly'])$(('#'+id)).addEventListener('change',refreshCoalitions);
$('#fullNames').addEventListener('change',()=>{if(current)display();});
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
function jsonp(url,code,params={}){
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
  script.src=url+(url.includes('?')?'&':'?')+'code='+encodeURIComponent(code)+'&callback='+encodeURIComponent(cb)+Object.entries(params).map(([k,v])=>'&'+encodeURIComponent(k)+'='+encodeURIComponent(v)).join('')+'&t='+Date.now();
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
