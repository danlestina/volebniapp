
    mapping = {}
    for name in PRESETS:
        search_names = (
            'Praha hl.m.', 'Praha', 'Hlavní město Praha'
        ) if name == 'Praha' else (name,)

        matches = [
            c for c in councils.values()
            if c['name'].casefold() in {
                x.casefold() for x in search_names
            }
        ]

        if name == 'Praha':
            matches = [c for c in matches if c['seats'] >= 40]

        if matches:
            matches.sort(
                key=lambda c: (c['seats'], c['id']),
                reverse=True
            )
            mapping[name] = matches[0]['id']
        else:
            print('POZOR nenalezena předvolba', name, file=sys.stderr)
