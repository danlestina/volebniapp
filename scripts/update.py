#!/usr/bin/env python3
"""ČSÚ 2026 -> statická data pro GitHub Pages. Jen standardní knihovna Pythonu.

Při výpadku ČSÚ nepřepisuje předchozí výsledky prázdnými hodnotami.
"""
from __future__ import annotations

import csv
import io
import json
import math
import os
import re
import sys
import time
import urllib.error
import urllib.request
from collections import Counter, defaultdict
from datetime import datetime, timezone, timedelta
from fractions import Fraction
from pathlib import Path
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'data'
REG_URL = 'https://volby.gov.cz/opendata/kv2026/csv_od/{}.csv'
RES_URL = 'https://volby.gov.cz/appdata/kv2026/20261009/odata/okresy/vysledky_obce_okres_{}.xml'
PIRATI_NSTRANA = '720'  # ČSÚ: Česká pirátská strana, NAVRHUJÍCÍ strana
PRESETS = ['České Budějovice', 'Praha', 'Praha 10', 'Čestlice', 'Deštné v Orlických horách', 'Brno']
DISTRICTS = ['CZ0100'] + ['CZ020' + s for s in '123456789ABC'] + [f'CZ031{i}' for i in range(1,8)] + [f'CZ032{i}' for i in range(1,8)] + [f'CZ041{i}' for i in range(1,4)] + [f'CZ042{i}' for i in range(1,8)] + [f'CZ051{i}' for i in range(1,5)] + [f'CZ052{i}' for i in range(1,6)] + [f'CZ053{i}' for i in range(1,5)] + [f'CZ063{i}' for i in range(1,6)] + [f'CZ064{i}' for i in range(1,8)] + [f'CZ071{i}' for i in range(1,6)] + [f'CZ072{i}' for i in range(1,5)] + [f'CZ080{i}' for i in range(1,7)]


def fetch(url, timeout=25):
    req = urllib.request.Request(url, headers={'User-Agent':'KomunalniKoalice/1.0 (open data; github pages)', 'Accept':'*/*'})
    for attempt in range(2):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as res:
                return res.read()
        except (urllib.error.URLError, TimeoutError) as e:
            if attempt == 1: raise
            time.sleep(1.5)


def csv_rows(name):
    b = fetch(REG_URL.format(name))
    for encoding in ('utf-8-sig', 'cp1250'):
        try: text = b.decode(encoding); break
        except UnicodeDecodeError: continue
    sample = text[:8192]
    try: sep = csv.Sniffer().sniff(sample, delimiters=';,\t').delimiter
    except csv.Error: sep = ';'
    return [{str(k).strip().lstrip('\ufeff').upper(): (v or '').strip() for k,v in row.items() if k} for row in csv.DictReader(io.StringIO(text), delimiter=sep)]


def num(value, default=0):
    try: return int(str(value).strip())
    except (TypeError, ValueError):
        try: return int(float(str(value).replace(',','.')))
        except (TypeError, ValueError): return default


def key(v): return str(num(v))


def lname(s): return s.split('}',1)[-1].upper()


def attrs(node): return {lname(k):v for k,v in node.attrib.items()}


def getint(a, *names):
    for n in names:
        if n in a and a[n] not in ('',None):return num(a[n])
    return None


def get_text(a, *names):
    for n in names:
        if n in a and str(a[n]).strip():return str(a[n]).strip()
    return None


def load_previous(file):
    try: return json.loads((DATA / file).read_text(encoding='utf-8'))
    except (OSError, json.JSONDecodeError): return {}


def dump(file, obj):
    DATA.mkdir(exist_ok=True)
    (DATA / file).write_text(json.dumps(obj, ensure_ascii=False, separators=(',',':'), sort_keys=True)+'\n', encoding='utf-8')


def build_registry():
    councils = csv_rows('kvrzcoco')
    ballots = csv_rows('kvros')
    candidates = csv_rows('kvrk')
    by_council = {}
    for row in councils:
        ident = key(row.get('KODZASTUP'))
        # Obce s více obvody mají v registru i řádky OBVODY=1/2.
        if not ident or ident == '0': continue
        if ident not in by_council or num(row.get('OBVODY')) in (0,1):
            by_council[ident] = {
                'id':ident, 'name':row.get('NAZEVZAST') or row.get('NAZEVOBCE') or ident,
                'region':num(row.get('KRAJ')), 'district':num(row.get('OKRES')),
                'seats':num(row.get('MANDATY')), 'wards':num(row.get('OBVODY')) != 0,
                'pirateNominated':0,'pirateCandidates':[], 'ballots':[]}
    # Zakládej kandidátky po (zastupitelstvo, obvod, strana); hlasovací číslo nemusí být shodné s OSTRANA.
    ballot_lookup = {}
    for b in ballots:
        cid=key(b.get('KODZASTUP'))
        if cid not in by_council:continue
        ward=key(b.get('COBVODU') or '1')
        party=key(b.get('OSTRANA'))
        ballot_no=key(b.get('POR_STR_HL'))
        item={'id':party,'ward':ward,'ballot':ballot_no, 'name':b.get('ZKRATKAO30') or b.get('NAZEVCELK') or f'Kandidátka {party}', 'fullName':b.get('NAZEVCELK') or '', 'candidates':0}
        ballot_lookup[(cid,ward,party)] = item
        by_council[cid]['ballots'].append(item)
    for c in candidates:
        if c.get('PLATNOST','A').upper() not in ('A','0'):continue
        cid=key(c.get('KODZASTUP'))
        if cid not in by_council:continue
        ward=key(c.get('COBVODU') or '1'); party=key(c.get('OSTRANA'))
        party_row=ballot_lookup.get((cid,ward,party))
        if party_row is not None:party_row['candidates']+=1
        if key(c.get('NSTRANA'))==PIRATI_NSTRANA:
            by_council[cid]['pirateNominated']+=1
            by_council[cid]['pirateCandidates'].append({'name':(c.get('JMENO','')+' '+c.get('PRIJMENI','')).strip(), 'party':party_row['name'] if party_row else '', 'ward':ward})
    for v in by_council.values():
        v['ballots'].sort(key=lambda b:(num(b['ward']),num(b['ballot'])))
    # Kraj ČSÚ používá číselný kód 3100. Jako druhé ověření okresů 3101–3107.
    southern = [v['id'] for v in by_council.values() if (v['region']==3100 or 3101<=v['district']<=3107) and v['pirateNominated']>0]
    southern.sort(key=lambda i:by_council[i]['name'].casefold())
    # Přesná shoda; Praha = zastupitelstvo hl. m., Praha 10 samostatná městská část.
    mapping = {}
    for name in PRESETS:
        matched = [v for v in by_council.values() if v['name'].casefold() == name.casefold()]
        if name == 'Praha':
            matched = [v for v in matched if v['name']=='Praha' and v['seats']>=40]
        if len(matched)==1:mapping[name]=matched[0]['id']
        elif matched: mapping[name]=sorted(matched,key=lambda v:v['seats'],reverse=True)[0]['id']
        else:print(f'UPOZORNĚNÍ: předvolba nenalezena: {name}',file=sys.stderr)
    print(f'Registr: {len(by_council)} zastupitelstev, {len(southern)} jihočeských s nominací Pirátů, předvoleb {len(mapping)}')
    return {'updated': datetime.now(timezone.utc).isoformat(), 'source':'ČSÚ / registry 2026','councils':by_council,'presets':mapping,'southBohemiaPirates':southern}


def parse_result_xml(data, council_ids=None):
    """Načte výsledky obce: hledá elementy VOLEBNI_STRANA s hlasy
    a jejich nejbližší identifikátor obce. Výsledek raději vynechá než odhadne.
    """
    root = ET.fromstring(data)
    out={}
    # Identifikátory v XML ČSÚ: CIS_OBEC je kód zastupitelstva u obcí i MČ/MO.
    # Více úrovní OBEC pro modely s obvody – každý záznam načteme odděleně.
    for obec in root.iter():
        if lname(obec.tag) != 'OBEC':continue
        a=attrs(obec)
        cid = getint(a,'KODZASTUP','CIS_OBEC','CIS_ZASTUP','KOD_OBCE','CIS_MC')
        if cid is None:continue
        cid=str(cid)
        if council_ids is not None and cid not in council_ids:continue
        party_nodes = [p for p in obec.iter() if lname(p.tag) == 'VOLEBNI_STRANA']
        if not party_nodes:continue
        parsed=[]
        for p in party_nodes:
            pa=attrs(p)
            ballot=getint(pa,'POR_STR_HL','PORADI_STRANY','CIS_STRANY','POR_STRANY','KSTRANA','PORADI')
            votes=getint(pa,'HLASY','HLASY_STR','HLASY_CELK','POC_HLASU','HLASY_VS','HLASY_STRANA','HLASY_POCET','HLASY_CELKEM','POC_HLASU_STR')
            if ballot is None:
                for k,v in pa.items():
                    if ('POR' in k or 'CIS' in k) and ('STR' in k or 'LIST' in k) and str(v).isdigit():
                        ballot = int(v); break
            if votes is None:
                for k,v in pa.items():
                    if ('HLASY' in k or 'HLASU' in k) and 'PROC' not in k and 'PODIL' not in k and str(v).isdigit():
                        votes = int(v); break
            if ballot is not None and votes is not None:
                parsed.append({'ballot':str(ballot),'votes':votes, 'officialSeats':getint(pa,'MANDATY','MAND_STR','POC_MANDATU','MANDATY_POCET')})
        if not parsed: continue
        if not any(p['votes'] > 0 for p in parsed): continue
        # Nejbližší údaje o sčítání (mohou být na elementu OBEC nebo VOLENI).
        scopes=[a]+[attrs(c) for c in obec.iter() if lname(c.tag) in ('VOLENI','VYSLEDKY')]
        processed=next((getint(x,'OKRSKY_ZPRAC','OKRSKY_ZPRACOV','ZPRACOVANO_OKRSKU') for x in scopes if getint(x,'OKRSKY_ZPRAC','OKRSKY_ZPRACOV','ZPRACOVANO_OKRSKU') is not None),None)
        total=next((getint(x,'OKRSKY_CELK','OKRSKY_CELKEM','OKRSKY_POCET') for x in scopes if getint(x,'OKRSKY_CELK','OKRSKY_CELKEM','OKRSKY_POCET') is not None),None)
        out[cid]={'processed':processed,'total':total,'parties':parsed}
    return out


def dhondt(parties, seats):
    """Výsledek pro jednu volební jednotku. Rovnost v rozhodném posledním mandátu: los, netvrdit jistotu."""
    votes_total=sum(p['votes'] for p in parties)
    if not votes_total or seats<1:return {p['ballot']:0 for p in parties},None,None
    valid=[p for p in parties if p['candidates']>0 and p['votes']>0]
    if not valid:return {p['ballot']:0 for p in parties},None,None
    threshold=None
    if len(parties)==1:
        eligible=valid
    else:
        for t in range(5,-1,-1):
            eligible=[p for p in valid if p['votes']*100*seats >= t*votes_total*min(p['candidates'],seats)]
            if len(eligible)>=2 and sum(min(p['candidates'],seats) for p in eligible)>= min(seats,max(5,(seats//2+1))):
                threshold=t;break
        else:
            eligible=valid;threshold=0
    quot=[]
    for p in eligible:
        for divisor in range(1,min(p['candidates'],seats)+1):
            quot.append((Fraction(p['votes'],divisor),p['votes'],p['ballot']))
    quot.sort(key=lambda x:(x[0],x[1]),reverse=True)
    winners=quot[:seats]
    tie=False
    if len(quot)>seats and winners:
        tie=quot[seats][:2]==quot[seats-1][:2]
    out=Counter(b for _,_,b in winners)
    return {p['ballot']:out[p['ballot']] for p in parties},threshold,tie


def assemble(raw, reg):
    # listinné názvy a počet kandidátů pochází z registru, hlasy z XML.
    result={}
    for ident, r in raw.items():
        c=reg['councils'].get(ident)
        if not c:continue
        if c['wards']:
            result[ident]={'status':'warded','message':'Více volebních obvodů – průběžné rozdělení mandátů zde není podporováno.'}
            continue
        lookup={str(x['ballot']):x for x in c['ballots']}
        parties=[]
        for p in r['parties']:
            b=lookup.get(p['ballot'])
            if not b:continue
            parties.append({'ballot':p['ballot'],'name':b['name'],'votes':p['votes'],'candidates':b['candidates'], 'officialSeats':p['officialSeats']})
        # Bez jednoznačného spojení oficiálních hlasů s registrací raději nezveřejnit výpočet.
        if not parties or len(parties)<len(lookup):
            result[ident]={'status':'unmatched','message':'Neúplné nebo nejednoznačné propojení hlasů a kandidátek v XML ČSÚ.'}
            continue
        allotted,threshold,tie=dhondt(parties,c['seats'])
        for p in parties:p['seats']=allotted.get(p['ballot'],0)
        done=r['processed'] is not None and r['total'] is not None and r['processed']==r['total']
        # Oficiální mandáty preferujeme pouze při potvrzeném dopočtu celé obce.
        if done and all(p['officialSeats'] is not None for p in parties):
            for p in parties:p['seats']=p['officialSeats']
        result[ident]={'status':'ok','processed':r['processed'],'total':r['total'], 'complete':done,
                       'threshold':threshold,'lotTie':tie,'parties':parties}
    return result


def update_registry():
    old=load_previous('registr.json')
    try:
        at=datetime.fromisoformat(old.get('updated',''))
        if old.get('councils') and datetime.now(timezone.utc)-at < timedelta(hours=12):
            return old
    except (TypeError, ValueError): pass
    try:
        r=build_registry()
        dump('registr.json',r)
        return r
    except Exception as e:
        old=load_previous('registr.json')
        if old.get('councils'):
            print(f'VAROVÁNÍ: registry ČSÚ nedostupné, použiji poslední: {e}',file=sys.stderr)
            return old
        raise


def update_results(reg):
    previous=load_previous('results.json')
    states=previous.get('results',{})
    fetched=0;failed=[]
    # Ověřit dostupnost (před začátkem sčítání vrací ČSÚ zatím prázdnou/404 odpověď).
    first=DISTRICTS[0]
    try:
        probe=fetch(RES_URL.format(first), timeout=8)
        initial=parse_result_xml(probe,set(reg['councils']))
        if not initial:
            print('ČSÚ ještě nevydává parsovatelná průběžná data; registry jsou připraveny.')
            return
    except (ET.ParseError, urllib.error.URLError, TimeoutError, OSError) as e:
        print(f'Čeká se na průběžné výsledky ČSÚ: {e}',file=sys.stderr)
        return
    for i,d in enumerate(DISTRICTS):
        try:
            xml=probe if d==first else fetch(RES_URL.format(d),timeout=10)
            raw=parse_result_xml(xml,set(reg['councils']))
            new=assemble(raw,reg)
            if new:
                states.update(new)
                fetched+=1
            elif b'<ERROR' in xml.upper() or b'<CHYBA' in xml.upper():
                failed.append(d+': odpověď ČSÚ obsahuje chybu')
        except (ET.ParseError,urllib.error.URLError, TimeoutError, OSError) as e:
            failed.append(d+': '+str(e)[:80])
    if failed:print('Neúspěšné okresy:',', '.join(failed[:16]),file=sys.stderr)
    print(f'Úspěšné okresy se záznamy: {fetched}/{len(DISTRICTS)}; obce s výsledky: {sum(r.get("status")=="ok" for r in states.values())}')
    dump('results.json',{'updated':datetime.now(timezone.utc).isoformat() if fetched else previous.get('updated'),
                         'districtsWithData':fetched, 'districtsAttempted':len(DISTRICTS),'results':states})


def main():
    reg=update_registry()
    # Výsledky se publikují až po 14. hodině 10. října. Nezobrazuje žádná smyšlená data.
    update_results(reg)

if __name__=='__main__':main()
