# Volební aplikace 2026 — verze 2

Výsledky komunálních voleb v libovolném českém zastupitelstvu, průběžný **neoficiální přepočet mandátů** a matematicky možné kombinace subjektů, které dosahují většiny nebo jim schází několik mandátů.

**Předvolby:** České Budějovice, Praha, Praha 10, Čestlice, Deštné v Orlických horách, Brno a skupina všech zastupitelstev v Jihočeském kraji, v nichž kandiduje platný kandidát *navržený Piráty* (`NSTRANA = 720`). Výběr libovolné další obce vyhledáváním.

## Jak nahradit starou verzi v repozitáři `volebniapp`

1. Rozbal ZIP. Získáš složku `volebniapp-v2`. **Nahrávej její obsah, ne složku samotnou.** Nový balíček úmyslně neobsahuje `data/registr.json`, aby ti nesmazal už úspěšně načtené kandidátky; při prvním běhu vznikne automaticky.
2. Na GitHubu otevři `https://github.com/danlestina/volebniapp`, v kartě **Code** zvol **Add file → Upload files** a přetáhni obsah rozbalené složky. Musí zůstat zachováno přesné členění cest (`index.html` přímo v kořeni, dále `app.js`, `.github/workflows/aktualizace.yml`, `scripts/update.py` a `data/...`). **Pozor: skrytou složku `.github` některé systémy nenahrají při přetažení.** Ověř ji na stránce repozitáře. Pokud GitHub nedovolí nahradit jednotlivé existující soubory přetažením, nejsnazší je GitHub Desktop, případně editace každého změněného souboru přímo na GitHubu.
3. V repozitáři jdi do **Settings → Pages → Build and deployment → Source → GitHub Actions** (NIKOLI „Deploy from a branch“). Výběr se obvykle uloží hned.
4. V **Settings → Actions → General → Workflow permissions** musí být umožněn zápis, pokud jej repozitář potřebuje. Ve workflow je výslovně požadované `contents: write`, `pages: write` a `id-token: write`.
5. Otevři **Actions → Volební výsledky a zveřejnění webu → Run workflow → Run workflow**. **První běh jednorázově stáhne registr všech kandidátů a kandidátek** (cca 190 tisíc kandidátů). To může chvíli trvat. Výsledný soubor `data/registr.json` již bude v repozitáři a další běhy jej nebudou opakovaně stahovat.
6. Po dokončení zkontroluj **Settings → Pages → Visit site** nebo `https://danlestina.github.io/volebniapp/`. Pokud běh končí červeně, otevři jeho podrobnosti a pošli protokol kroku s chybou. Kandidátní registr se ukládá samostatně před načítáním výsledků, takže může být zveřejněn i při chybě v následném XML.

### Důležité při nahrávání souborů

Předchozí ručně přidaný `.github/workflows/aktualizace.yml` **musí být nahrazen novým obsahem**. Jinak bude aktivní stará automatizace. Pokud nový ZIP nenahraješ přes GitHub Desktop, otevři `.github/workflows/aktualizace.yml` přímo na GitHubu a obsah ručně nahraď přiloženým souborem.

Neodstraň soubor `data/registr.json`, pokud už obsahuje skutečné registry! Výsledková data v `data/okresy/` jsou nové uspořádání; původní `data/results.json` v repozitáři může zůstat, ale nová verze jej nepoužívá. Před prvním během je důležité, aby `data/state.json` mělo správný `lastBatch`; nová verze začíná od dávky 1. Pokud už proběhlo sčítání, postupně zpracuje všechny dřívější dávky.

## Jak funguje aktualizace

- **Seznamy kandidátů a kandidátek**: stáhnou se z ČSÚ **při prvním úspěšném běhu jen jednou** a zůstanou v `data/registr.json`. Pro nucené obnovení zaškrtni při **Run workflow** volbu `refresh_registry`.
- **Průběžné výsledky**: ČSÚ od roku 2026 vydává změněné obce v přírůstkových XML dávkách `.../odata/obce_d/vysledky_obce_00001.xml`, další `00002.xml` atd. Číslo poslední zpracované dávky je v `data/state.json`. Automatizace pokračuje od dalšího čísla a po přerušení dočte chybějící dávky. Při chybě XML se zastaví místo přeskočení dávky.
- **Velikost dat pro prohlížeč**: po načtení registru stahuje výsledky jen z jednoho souboru `data/okresy/<kód-okresu>.json` pro aktuálně vybrané zastupitelstvo. Při pravidelných kontrolách stáhne jen drobný `data/state.json`, a nové výsledky okresu až při změně čísla dávky.
- **Publikování**: workflow samo vytvoří balíček webu a zveřejní jej přes GitHub Pages. Už nezávisí na tom, zda nový commit vytvořený automatizací vyvolá sestavení stránky.

## Nastavení frekvence

**A. Stahování ČSÚ (GitHub):** uprav v `.github/workflows/aktualizace.yml` řádek `cron`. Výchozí `3,13,23,33,43,53 * * * *` = každých 10 minut. Pro 5 minut zadej `'*/5 * * * *'`, pro 15 minut `'*/15 * * * *'`. GitHub může běh odložit, minimum je 5 minut; nelze přepínat přímo tlačítkem na veřejném webu.

**B. Kontrola nového výsledku v otevřeném prohlížeči:** vyber přímo na stránce 1, 2, 5 nebo 10 minut, případně klikni „Zkontrolovat nyní“. To **nespouští** nové stahování ČSÚ. Nastavení zůstane uložené v prohlížeči.

## Co ověřit po prvním spuštění

1. V protokolu kroku `Jednorázově načíst registry kandidátů ČSÚ` musí být přibližně 6 tisíc a více zastupitelstev (kontrola úplnosti neumožní import jen malé části registru).
2. V `data/registr.json` je více než 5 tisíc zastupitelstev a seznam `southBohemiaPirates` není prázdný.
3. Jakmile ČSÚ publikuje alespoň jednu dávku, `data/state.json` ukáže `lastBatch >= 1`, a vznikne alespoň jeden soubor ve složce `data/okresy`.
4. Přepočet konkrétní obce porovnej s oficiálními daty ČSÚ (zejména součty hlasů, vylosovaným číslem kandidátky, mandáty po úplném sečtení). **Přímé ověření živých CSV/XML nebylo v prostředí tvorby možné**; může se ukázat odlišnost od testovaných syntetických XML. Bez takového ověření není vhodné vydávat výpočty za definitivně ověřené.

## Výpočet a jeho omezení

Algoritmus implementuje vstupní hranici upravenou dle počtu platných kandidátů, její postupné snižování, d’Hondtovu řadu a omezení počtu mandátů počtem kandidátů. Shodné podíly, kde nestačí ani počet hlasů strany, vyžadují los – v aplikaci se zobrazí varování. Jde o **aritmetiku podle doposud sečtených okrsků**, nikoliv o předpověď výsledku; u více volebních obvodů v obci průběžný přepočet není podporován. Dosažitelné většiny v aplikaci nejsou politickým doporučením.

## Podklady

- [ČSÚ – registry, otevřená data](https://volby.gov.cz/opendata/kv2026/kv2026_opendata_seznam.htm)
- [ČSÚ – přírůstkové obecní dávky](https://volby.gov.cz/opendata/kv2026/KV2026_XML.htm)
- [ČSÚ – metodika mandátů](https://csu.gov.cz/docs/107516/60133edd-7ea3-d25d-d3d0-c2ed275d42b3/rozdelovanimandatuzo26.pdf?version=1.1)

Testy: `python -m unittest discover -s tests -v`. Skript vyžaduje pouze Python 3.12 a standardní knihovnu.
