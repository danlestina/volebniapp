#!/usr/bin/env python3
"""Registr ČSÚ stáhnout jednou, dále inkrementální stavové dávky obcí.

Bez externích knihoven. Každá úspěšná dávka nahrazuje údaje dotčené obce;
nevytváří se žádný odhad za dosud nesečtené okrsky.
"""
from __future__ import annotations
import argparse
import csv
import io
import json
import os
import sys
import time
import urllib.error
import urllib.request
from collections import Counter
from datetime import datetime, timezone
from fractions import Fraction
from pathlib import Path
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'data'
DIST_DIR = DATA / 'okresy'
REG_URL = 'https://volby.gov.cz/opendata/kv2026/csv_od/{}.csv'
BATCH_URL = 'https://volby.gov.cz/appdata/kv2026/20261009/odata/obce_d/vysledky_obce_{:05d}.xml'
PIRATI_NSTRANA = '720'
PRAHA_COUNCIL_ID = '554782'  # KODZASTUP hlavního města Prahy podle ČSÚ
PRESETS = ['České Budějovice', 'Praha', 'Praha 10', 'Čestlice', 'Deštné v Orlických horách', 'Brno']
MAX_BATCHES = 100  # po delším výpadku zbytek dožene další běh; nikdy nevynechá dávku


def now():
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def read_json(path, fallback=None):
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return {} if fallback is None else fallback


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    text=json.dumps(value, ensure_ascii=False, separators=(',', ':'), sort_keys=True)+'\n'
    if path.exists() and path.read_text(encoding='utf-8')==text:
        return False
    path.write_text(text, encoding='utf-8')
    return True


def fetch(url, timeout=20):
    request=urllib.request.Request(url, headers={'User-Agent':'VolebniApp2026/2.0 (public election open data)','Accept':'application/xml,text/csv,*/*'})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return response.read()
        except urllib.error.HTTPError as ex:
            if ex.code in (400, 404):
                raise  # typický konec dostupných dávek; zbytečně neopakovat
            if attempt==2:raise
        except (urllib.error.URLError,TimeoutError):
            if attempt==2:raise
        time.sleep(1.5*(attempt+1))


def norm_int(v,default=0):
    try:return int(str(v).strip())
    except (TypeError,ValueError):return default


def code(v):
    return str(norm_int(v))


def uppername(tag):
    return str(tag).split('}',1)[-1].upper()


def attr(node):
    return {uppername(k):v for k,v in node.attrib.items()}


def pick_num(mapping,*names):
    for n in names:
        if n in mapping and str(mapping[n]).strip()!='':
            return norm_int(mapping[n],None)
    return None


def load_csv(name):
    raw=fetch(REG_URL.format(name), timeout=35)
    text=raw.decode('utf-8-sig')
    sample=text[:5000]
    try:separator=csv.Sniffer().sniff(sample,delimiters=';,\t').delimiter
    except csv.Error:separator=';'
    return [{k.strip().upper():(v or '').strip() for k,v in row.items() if k} for row in csv.DictReader(io.StringIO(text),delimiter=separator)]


def fix_praha_preset(registry):
    """Doplní předvolbu Prahy také do jednou staženého registru."""
    councils = registry.get('councils', {})
    if PRAHA_COUNCIL_ID not in councils:
        raise ValueError('Registr ČSÚ neobsahuje zastupitelstvo Prahy 554782; nelze opravit předvolbu.')
    presets = registry.setdefault('presets', {})
    if presets.get('Praha') == PRAHA_COUNCIL_ID:
        return False
    presets['Praha'] = PRAHA_COUNCIL_ID
    return True


def build_registry():
    councils_rows=load_csv('kvrzcoco')
    lists_rows=load_csv('kvros')
    candidates_rows=load_csv('kvrk')
    councils={}
    for row in councils_rows:
        id=code(row.get('KODZASTUP'))
        if id=='0':continue
        obvody=norm_int(row.get('OBVODY'))
        if id not in councils or obvody in (0,1):
            councils[id]={'id':id,'name':row.get('NAZEVZAST') or row.get('NAZEVOBCE') or id,
                          'region':norm_int(row.get('KRAJ')),'district':norm_int(row.get('OKRES')),
                          'seats':norm_int(row.get('MANDATY')),'wards':obvody==1,
                          'pirateNominated':0,'pirateCandidates':[],'ballots':[]}
    lookup={}
    for row in lists_rows:
        id=code(row.get('KODZASTUP'))
        if id not in councils:continue
        ward=code(row.get('COBVODU') or 1)
        party=code(row.get('OSTRANA'))
        ballot=code(row.get('POR_STR_HL'))
        item={'id':party,'ward':ward,'ballot':ballot,
              'name':row.get('ZKRATKAO30') or row.get('NAZEVCELK') or ('Kandidátka '+party),
              'candidates':0}
        lookup[(id,ward,party)]=item
        councils[id]['ballots'].append(item)
    for row in candidates_rows:
        if row.get('PLATNOST','A').upper() not in ('A','0'):continue
        id=code(row.get('KODZASTUP'))
        if id not in councils:continue
        ward=code(row.get('COBVODU') or 1)
        party=code(row.get('OSTRANA'))
        item=lookup.get((id,ward,party))
        if item is not None:
            item['candidates']+=1
        if code(row.get('NSTRANA'))==PIRATI_NSTRANA:
            councils[id]['pirateNominated']+=1
            councils[id]['pirateCandidates'].append({'name':(row.get('JMENO','')+' '+row.get('PRIJMENI','')).strip(),
                                                      'party':item['name'] if item else '', 'ward':ward})
    if len(councils)<5000 or len(lists_rows)<15000 or len(candidates_rows)<120000:
        raise ValueError(f'Neúplný registr ČSÚ: {len(councils)} obcí, {len(lists_rows)} kandidátek, {len(candidates_rows)} kandidátů')
    for c in councils.values():
        c['ballots'].sort(key=lambda p:(norm_int(p['ward']),norm_int(p['ballot'])))
    south=sorted([id for id,c in councils.items() if (c['region']==3100 or 3101<=c['district']<=3107) and c['pirateNominated']],
                 key=lambda id:councils[id]['name'].casefold())
    mapping={}
    for name in PRESETS:
        # Praha ma v registru CSU jiny nazev nez v predvolbach.
        search_names = ('Praha hl.m.', 'Praha', 'Hlavni mesto Praha', 'Hlavní město Praha') if name == 'Praha' else (name,)
        folded_names = {x.casefold() for x in search_names}
        matches=[c for c in councils.values() if c['name'].casefold() in folded_names]
        if name=='Praha':
            matches=[c for c in matches if c['seats']>=40]
        if matches:
            matches.sort(key=lambda c:(c['seats'],c['id']), reverse=True)
            mapping[name]=matches[0]['id']
        else:print('POZOR nenalezena předvolba',name,file=sys.stderr)
    fix_praha_preset({'councils': councils, 'presets': mapping})
    print(f'Registry ČSÚ: {len(councils)} zastupitelstev, {len(south)} jihočeských s nominací Pirátů, {len(mapping)} předvoleb')
    return {'updated':now(),'source':'ČSÚ – registr kandidátek a kandidátů pro komunální volby 2026',
            'councils':councils,'presets':mapping,'southBohemiaPirates':south}


def ensure_registry(force=False):
    p=DATA/'registr.json'
    previous=read_json(p)
    if len(previous.get('councils',{}))>5000 and not force:
        if fix_praha_preset(previous):
            write_json(p, previous)
            print('Doplněna předvolba Praha (554782) do již uloženého registru.')
        print('Registr kandidátů: používám již uložená data, znovu nestahuji.')
        return previous
    value=build_registry()
    write_json(p,value)
    return value


def parse_batch(xml):
    """Vrací stavové záznamy OBEC. Pokud se XML liší od očekávaného,
    vyvolá výjimku, aby se NEposunul kurzor a nebyly tiše přeskočeny obce.
    """
    root=ET.fromstring(xml)
    for node in root.iter():
        a=attr(node)
        if uppername(node.tag) in ('CHYBA','ERROR') or str(a.get('KOD_CHYBY','')) in ('10','9999'):
            raise ValueError('ČSÚ oznámil chybu v XML: '+ET.tostring(node,encoding='unicode')[:220])
    out={}
    encountered=0
    for node in root.iter():
        if uppername(node.tag)!='OBEC':continue
        encountered+=1
        a=attr(node)
        id=pick_num(a,'KODZASTUP','CIS_OBEC','CIS_ZASTUP','KOD_OBCE')
        if id is None:
            raise ValueError('V dávce je zastupitelstvo OBEC bez rozpoznaného KODZASTUP; kurzor se neposune.')
        parties=[]
        for p in node.iter():
            if uppername(p.tag) not in ('VOLEBNI_STRANA','STRANA'):continue
            pa=attr(p)
            ballot=pick_num(pa,'POR_STR_HLAS_LIST','POR_STR_HL','PORADI_STRANY','CIS_STRANY','POR_STRANY','KSTRANA','PORADI')
            votes=pick_num(pa,'HLASY_STR','HLASY','HLASY_CELK','POC_HLASU','HLASY_VS','HLASY_STRANA','HLASY_POCET','HLASY_CELKEM','POC_HLASU_STR')
            if ballot is not None and votes is not None:
                elected=[]
                for z in p.iter():
                    if uppername(z.tag)!='ZASTUPITEL':continue
                    za=attr(z)
                    person=' '.join(v for v in (za.get('TITULPRED'),za.get('JMENO'),za.get('PRIJMENI'),za.get('TITULZA')) if v).strip()
                    if person:
                        elected.append({'name':person,'order':pick_num(za,'PORADOVE_CISLO'),
                                        'votes':pick_num(za,'HLASY')})
                parties.append({'ballot':str(ballot),'votes':votes,
                                'officialSeats':pick_num(pa,'ZASTUPITELE_POCET','MAND_STR','MANDATY','POC_MANDATU','MANDATY_POCET'),
                                'elected':elected})
        if not parties:
            raise ValueError(f'Zastupitelstvo {id} v dávce nemá rozpoznané kandidátky ani hlasy; dávka se nepřeskočí.')
        processed=pick_num(a,'OKRSKY_ZPRAC','OKRSKY_ZPRACOV','ZPRACOVANO_OKRSKU')
        total=pick_num(a,'OKRSKY_CELKEM','OKRSKY_CELK','OKRSKY_POCET')
        if processed is None or total is None:
            for child in node.iter():
                ca=attr(child)
                if processed is None:processed=pick_num(ca,'OKRSKY_ZPRAC','OKRSKY_ZPRACOV','ZPRACOVANO_OKRSKU')
                if total is None:total=pick_num(ca,'OKRSKY_CELKEM','OKRSKY_CELK','OKRSKY_POCET')
        out[str(id)]={'processed':processed,'total':total,'parties':parties}
    if not out:
        raise ValueError('Dávka neobsahuje rozpoznané záznamy OBEC a hlasy kandidátek; kurzor se neposune.')
    for node in root:
        if uppername(node.tag)=='DAVKA':
            declared=pick_num(attr(node),'POCET_OBCI')
            if declared is not None and declared!=encountered:
                raise ValueError(f'Dávka deklaruje {declared} obcí, XML obsahuje {encountered}; kurzor se neposune.')
            break
    return out


def dhondt(parties,seats):
    """§45 zák. 491/2001 Sb. Vracení losové situace, nepředstírat jistotu."""
    total=sum(p['votes'] for p in parties)
    zero={p['ballot']:0 for p in parties}
    if not total or seats<=0:return zero,None,False
    valid=[p for p in parties if p['candidates']>0 and p['votes']>0]
    if not valid:return zero,None,False
    if len(parties)==1:
        eligible=valid;threshold=None
    else:
        eligible=[];threshold=0
        for t in (5,4,3,2,1,0):
            cand=[p for p in valid if p['votes']*100*seats >= t*total*min(p['candidates'],seats)]
            # druhá podmínka: alespoň nadpoloviční většina a pro vícečlenné zastupitelstvo přes 5 členů
            need=min(seats,max(seats//2+1,5))
            if len(cand)>=2 and sum(min(p['candidates'],seats) for p in cand)>=need:
                eligible=cand;threshold=t;break
        if not eligible:eligible=valid;threshold=0
    quot=[]
    for p in eligible:
        for divisor in range(1,min(p['candidates'],seats)+1):
            quot.append((Fraction(p['votes'],divisor),p['votes'],p['ballot']))
    quot.sort(key=lambda q:(q[0],q[1]),reverse=True)
    winner=quot[:seats]
    tie=len(quot)>seats and bool(winner) and quot[seats][:2]==quot[seats-1][:2]
    count=Counter(x[2] for x in winner)
    return {p['ballot']:count[p['ballot']] for p in parties},threshold,tie


def assemble(raw,reg):
    result={}
    for id, entry in raw.items():
        council=reg['councils'].get(id)
        if council is None:continue
        if council['wards']:
            result[id]={'status':'warded','message':'Více volebních obvodů – rozdělení mandátů zatím nepočítáme.'}
            continue
        lists={b['ballot']:b for b in council['ballots'] if b['ward']=='1'}
        parties=[]
        for p in entry['parties']:
            match=lists.get(p['ballot'])
            if match:
                parties.append({**p,'name':match['name'],'candidates':match['candidates']})
        if not parties or len(parties)!=len(lists) or len(set(p['ballot'] for p in parties))!=len(parties):
            result[id]={'status':'unmatched','message':'ČSÚ XML neodpovídá registru kandidátek; nelze bezpečně přepočítat.'}
            continue
        seats,threshold,tie=dhondt(parties,council['seats'])
        official=sum(p['officialSeats'] or 0 for p in parties)
        complete=(entry['total'] is not None and entry['processed'] is not None and entry['total']==entry['processed'])
        if official==council['seats'] and all(p['officialSeats'] is not None for p in parties):
            complete=True
        for p in parties:
            p['seats']=p['officialSeats'] if complete and official==council['seats'] else seats.get(p['ballot'],0)
        result[id]={'status':'ok','processed':entry['processed'],'total':entry['total'],
                    'complete':complete,'threshold':threshold,'lotTie':tie,'parties':parties}
    return result


def apply_batch(parsed,reg):
    # Ukládání po okresích: prohlížeč načítá pouze 1 malý soubor pro vybranou obec.
    patch=assemble(parsed,reg)
    by_district={}
    for id,row in patch.items():
        dist=str(reg['councils'][id]['district'])
        by_district.setdefault(dist,{})[id]=row
    for district,change in by_district.items():
        path=DIST_DIR/(district+'.json')
        previous=read_json(path,{'results':{}})
        original=previous.get('results',{})
        original.update(change)
        write_json(path,{'results':original})
    return len(patch),len(by_district)


def update_batches(reg):
    path=DATA/'state.json'
    state=read_json(path,{'version':2,'lastBatch':0,'updated':None})
    cursor=norm_int(state.get('lastBatch'))
    total_obec=0
    for n in range(cursor+1,cursor+MAX_BATCHES+1):
        try:
            xml=fetch(BATCH_URL.format(n))
        except urllib.error.HTTPError as e:
            if e.code in (400,404):
                print(f'ČSÚ: dávka {n:05d} není zatím dostupná (HTTP {e.code}); poslední zpracovaná {cursor:05d}.')
                break
            raise
        try:
            patch=parse_batch(xml)
        except (ET.ParseError,ValueError) as err:
            # ČSÚ někdy vrací XML kód chyby 10 při neexistující dávce;
            # nikdy jej neoznačíme jako úspěšně zpracovaný.
            if 'KOD_CHYBY="10"' in xml.decode('utf-8','replace') or 'KOD_CHYBY="10"' in str(err):
                print('ČSÚ: další dávka ještě není vydána:',n)
                break
            raise RuntimeError(f'Dávka {n:05d} má neočekávaný formát: {err}') from err
        count,_=apply_batch(patch,reg)
        if count==0:
            raise RuntimeError(f'Dávka {n:05d} neobsahuje žádná registrovaná zastupitelstva, odmítám přeskočit.')
        total_obec+=count
        cursor=n
        state={'version':2,'lastBatch':cursor,'updated':now(),
               'source':'ČSÚ – přírůstkové výsledky obcí 2026'}
        write_json(path,state)
    print(f'Inkrementální data: dokončeno po dávku {cursor:05d}, změněných záznamů obcí {total_obec}.')


def main():
    parser=argparse.ArgumentParser(description='Registr ČSÚ jednorázově, výsledky dávkově')
    parser.add_argument('--registry-only',action='store_true')
    parser.add_argument('--results-only',action='store_true')
    args=parser.parse_args()
    if args.registry_only and args.results_only:parser.error('Nelze kombinovat --registry-only a --results-only')
    force=os.environ.get('FORCE_REGISTRY','').lower() in ('true','yes','1')
    reg=ensure_registry(force=force and not args.results_only)
    if not args.registry_only:update_batches(reg)

if __name__=='__main__':main()
