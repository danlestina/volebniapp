import unittest
from scripts.update import dhondt, parse_result_xml

class ElectionTests(unittest.TestCase):
    def test_dhondt_standard(self):
        p=[{'ballot':'1','votes':1000,'candidates':10}, {'ballot':'2','votes':800,'candidates':10}, {'ballot':'3','votes':200,'candidates':10}]
        got,tie,extra=dhondt(p,10)
        self.assertEqual(sum(got.values()),10)
        self.assertGreater(got['1'],got['3'])
    def test_cannot_get_more_seats_than_candidates(self):
        p=[{'ballot':'1','votes':3000,'candidates':2},{'ballot':'2','votes':1000,'candidates':12}]
        got,threshold,tie=dhondt(p,10)
        self.assertLessEqual(got['1'],2)
        self.assertEqual(sum(got.values()),10)
    def test_single_list(self):
        p=[{'ballot':'1','votes':300,'candidates':4}]
        got,threshold,tie=dhondt(p,9)
        self.assertEqual(got['1'],4)
        self.assertIsNone(threshold)
    def test_parser(self):
        xml=b'<VYSLEDKY_OBCE_OKRES><DATA><OBEC CIS_OBEC="544256" OKRSKY_ZPRAC="4" OKRSKY_CELK="20"><VOLEBNI_STRANA POR_STR_HL="3" HLASY="200" MANDATY="0"/><VOLEBNI_STRANA POR_STR_HL="4" HLASY="300"/></OBEC></DATA></VYSLEDKY_OBCE_OKRES>'
        d=parse_result_xml(xml)
        self.assertEqual(d['544256']['parties'][1]['votes'],300)
        self.assertEqual(d['544256']['total'],20)

if __name__=='__main__':unittest.main()
