# Komunální koalice 2026

Jednoduchá bezplatná webová aplikace pro **průběžné přepočítávání mandátů** do českých zastupitelstev a zobrazení všech početně možných koalic (nebo kombinací, kterým chybí 1–3 mandáty). Jde o neoficiální přepočet hlasů dostupných v daný okamžik, nikoliv o odhad výsledku ještě nesečtených okrsků.

## Kde jsou předvolby

České Budějovice, Praha, Praha 10, Čestlice, Deštné v Orlických horách, Brno. A dále **automaticky všechny obce Jihočeského kraje, kde kandiduje alespoň jeden platný kandidát navržený Piráty**. Ověřuje se `NSTRANA = 720` (Česká pirátská strana) v oficiálním *registru kandidátů ČSÚ*, nikoliv pouze název kandidátní listiny či politická příslušnost kandidáta. Seznam se naplní po prvním úspěšném běhu skriptu.

V aplikaci lze vyhledat jakékoliv jiné zastupitelstvo z ČR včetně městských částí Prahy. Pro aktuální výsledky si automatizace stahuje okresní XML data ČSÚ.

## Zprovoznění na GitHubu – bez instalace a hostingu

1. Na [github.com/new](https://github.com/new) vytvoř **nový veřejný repozitář** (např. `komunalni-koalice`). Zaškrtni **Public**; ostatní volby mohou zůstat výchozí. Klikni **Create repository**.
2. Rozbal stažený ZIP. Na stránce repozitáře zvol **Add file → Upload files** a nahraj *obsah* rozbalené složky: `index.html`, `app.js`, `README.md`, `data`, `scripts`, `tests`, **`.github/workflows/aktualizace.yml`** a `.nojekyll`. Pokud tvůj prohlížeč nepovolí nahrát složky, použij bezplatný **GitHub Desktop**. Důležité: `.github/workflows` musí být skutečně nahraná; pouhý obsah HTML nemůže sám stahovat výsledky ČSÚ. Dole potvrď **Commit changes**.
3. V repozitáři otevři **Settings → Pages**, v části **Build and deployment → Source** vyber **Deploy from a branch**, dále **Branch: main / (root)** a klikni **Save**. GitHub zde po krátké době ukáže adresu `https://TVUJ-UCET.github.io/komunalni-koalice/`.
4. Přejdi na **Actions → Aktualizovat výsledky ČSÚ → Run workflow → Run workflow**. Je-li potřeba, povol Actions tlačítkem **Enable workflows**. Počkej, až se zobrazí zelené zaškrtnutí. Ve složce `data` pak musí přibýt naplněný `registr.json`. Případné chyby jsou vidět v protokolu kroku „Načíst oficiální registry a hlasy“.
5. Znovu načti webovou stránku. Automatické spouštění je nastaveno každých **10 minut**, GitHub však může běh opozdit. Stránka sama kontroluje nová data po minutě.

**Nemusíš mít zapnutý počítač.** GitHub Actions běží nezávisle. Nepoužívá žádný placený server ani přístupový klíč. GitHub Pages může být dostupné veřejně každému, kdo zná adresu. Pokud GitHub odmítne automatický zápis nových dat, nastav v **Settings → Actions → General → Workflow permissions** možnost **Read and write permissions**.

## Stav a limity

- Výsledky 2026 ČSÚ podle oficiálního oznámení začínají přicházet v sobotu **10. října po 14:00**; do té doby budou výsledky prázdné, přestože registr kandidátek se už načetl.
- Používá § 45 zákona č. 491/2001 Sb.: přepočtenou 5% klauzuli pro kratší kandidátky, případné snížení klauzule, d'Hondtovy dělitele 1, 2, 3 … pouze do počtu platných kandidátů. Rovné rozhodné podíly mohou vyžadovat los.
- Při **více volebních obvodech v jedné obci** se zde průběžné mandáty nepočítají; výsledek je označen jako nepodporovaný. Nejde o celostátně pokročilou prognózu a nezohledňuje budoucí geografii sčítání.
- Údaje o stranách nepředstavují doporučení možných reálných koalic; kombinace jsou pouze součty mandátů.
- Výsledky se stahují automaticky z veřejně dostupných okresních XML (cca 77 požadavků na aktualizaci). Předvolby všech krajů se vytvářejí z registru. Datové servery mohou být ve volební špičce nedostupné; aplikace při výpadku zachová naposledy dostupný stav.
- **Důležité pro otestování:** v tomto prostředí nebylo možné stáhnout skutečná CSV a XML z ČSÚ, proto nebylo možné celý import ověřit na živých datech. Součástí je několik jednotkových testů, ale po prvním běhu na GitHubu je potřeba ověřit, že se načtou registry i výsledky. Pokud se formulář nevyplní, protokol Actions ukáže problém. Zdrojové odkazy a struktury polí vycházejí z oficiální dokumentace ČSÚ pro rok 2026.

## Odkazy

- [ČSÚ – otevřená data 2026](https://volby.gov.cz/opendata/kv2026/kv2026_opendata.htm)
- [ČSÚ – registry a číselníky 2026](https://volby.gov.cz/opendata/kv2026/kv2026_opendata_seznam.htm)
- [ČSÚ – popis souborů XML](https://volby.gov.cz/opendata/kv2026/KV2026_XML.htm)
- [ČSÚ – popis registrů](https://volby.gov.cz/opendata/kv2026/KV2026regPopis.htm)
- [ČSÚ – metodika přidělování mandátů](https://csu.gov.cz/docs/107516/60133edd-7ea3-d25d-d3d0-c2ed275d42b3/rozdelovanimandatuzo26.pdf?version=1.1)

## Technická údržba

Aplikace je čistě statický `index.html` + `app.js`, obnovovací Python skript a workflow GitHub Actions. Lze spustit testy `python -m unittest discover -s tests -v`. Žádná další závislost není potřebná. Dvě JSON ve složce `data` jsou zpočátku prázdná a při prvním úspěšném naplánovaném běhu se zaplní.
