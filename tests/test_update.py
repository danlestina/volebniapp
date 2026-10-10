import json
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import patch

from scripts import update as u


class ElectionTests(unittest.TestCase):
    def test_dhondt_basic(self):
        lists=[{'ballot':'1','votes':1000,'candidates':10},
               {'ballot':'2','votes':800,'candidates':10},
               {'ballot':'3','votes':200,'candidates':10}]
        seats,threshold,tie=u.dhondt(lists,10)
        self.assertEqual(sum(seats.values()),10)
        self.assertEqual(threshold,5)
        self.assertGreater(seats['1'],seats['3'])

    def test_short_list_threshold(self):
        lists=[{'ballot':'1','votes':3000,'candidates':2},
               {'ballot':'2','votes':1000,'candidates':10}]
        seats,threshold,tie=u.dhondt(lists,10)
        self.assertEqual(sum(seats.values()),10)
        self.assertLessEqual(seats['1'],2)

    def test_single_list_does_not_cross_threshold(self):
        lists=[{'ballot':'1','votes':300,'candidates':4}]
        seats,threshold,tie=u.dhondt(lists,9)
        self.assertEqual(seats['1'],4)
        self.assertIsNone(threshold)

    def test_tie_at_last_seat_warns(self):
        lists=[{'ballot':'1','votes':100,'candidates':3},
               {'ballot':'2','votes':100,'candidates':3}]
        seats,threshold,tie=u.dhondt(lists,1)
        self.assertTrue(tie)

    def test_parse_state_batch(self):
        xml=b'<VYSLEDKY_OBCE><OBEC CIS_OBEC="544256" OKRSKY_ZPRAC="4" OKRSKY_CELK="20"><VOLEBNI_STRANA POR_STR_HL="3" HLASY_STR="200"/><VOLEBNI_STRANA POR_STR_HL="4" HLASY_STR="300"/></OBEC></VYSLEDKY_OBCE>'
        data=u.parse_batch(xml)
        self.assertEqual(data['544256']['parties'][1]['votes'],300)
        self.assertEqual(data['544256']['total'],20)

    def test_parse_unknown_batch_aborts(self):
        with self.assertRaises(ValueError):
            u.parse_batch(b'<VYSLEDKY_OBCE><NESOUVISICI/></VYSLEDKY_OBCE>')

    def test_assemble_matches_official_ballot_number_not_party_id(self):
        reg={'councils':{'544256':{'id':'544256','name':'Obec','district':3101,'wards':False,'seats':3,
                       'ballots':[{'id':'77','ballot':'3','name':'A','ward':'1','candidates':3},
                                  {'id':'78','ballot':'4','name':'B','ward':'1','candidates':3}]}}}
        raw={'544256':{'processed':2,'total':10,'parties':[
                       {'ballot':'3','votes':200,'officialSeats':None},
                       {'ballot':'4','votes':300,'officialSeats':None}]}}
        got=u.assemble(raw,reg)['544256']
        self.assertEqual(got['status'],'ok')
        self.assertEqual(sum(p['seats'] for p in got['parties']),3)
        self.assertFalse(got['complete'])

    def test_cursor_advances_only_after_valid_batch(self):
        with tempfile.TemporaryDirectory() as tmp:
            data=Path(tmp)/'data';data.mkdir()
            district=data/'okresy';district.mkdir()
            u.write_json(data/'state.json',{'version':2,'lastBatch':0,'updated':None})
            reg={'councils':{'544256':{'id':'544256','name':'Obec','district':3101,'wards':False,'seats':3,
                 'ballots':[{'id':'77','ballot':'3','name':'A','ward':'1','candidates':3},
                            {'id':'78','ballot':'4','name':'B','ward':'1','candidates':3}]}}}
            good=b'<ROOT><OBEC CIS_OBEC="544256"><VOLEBNI_STRANA POR_STR_HL="3" HLASY_STR="200"/><VOLEBNI_STRANA POR_STR_HL="4" HLASY_STR="300"/></OBEC></ROOT>'
            def fake_fetch(url,timeout=20):
                if url.endswith('00001.xml'):return good
                if url.endswith('00002.xml'):return b'<ROOT><WRONG/></ROOT>'
                raise AssertionError(url)
            with patch.object(u,'DATA',data),patch.object(u,'DIST_DIR',district),patch.object(u,'fetch',fake_fetch):
                with self.assertRaises(RuntimeError):u.update_batches(reg)
                self.assertEqual(u.read_json(data/'state.json')['lastBatch'],1)
                out=u.read_json(district/'3101.json')['results']['544256']
                self.assertEqual(out['parties'][0]['votes'],200)


if __name__=='__main__':unittest.main()
