# Hades Console — Electron aplikácia

Desktopové okno konzoly Hades (AI-mind). Je to obal nad `/console` na HTTP serveri, bez duplikácie logiky.

## Inštalácia a spustenie

```bash
npm install --no-audit --no-fund
npm start
```

## Ako to funguje

1. **Autentizácia**: Token sa hľadá v poradí:
   - Env variable `HADES_UI_TOKEN`
   - `~/.hades/config.json` (`ui_token` pole)
   - `.env` v projekte Laravel (ROOT kde je `artisan`)
   
   Token sa do každého requestu na `HADES_URL` vloží do hlavičky `X-Hades-Ui-Token`.

2. **URL**: Načítava sa `$HADES_URL/console` (default `http://localhost:8080/console`).

3. **UI**:
   - Tray ikona s možnosťami (Otvoriť, Skryť, Ukončiť)
   - Ctrl+Alt+H — prepínanie viditeľnosti okna
   - Zatvorenie okna = skrytie (systém tray); Ukončiť = výslovne v menu

4. **Notifikácie**: Keď agent dobehne, okno si to vypočuje z `#run-announce` v stránke a 
   ak okno nie je zaostrené, zobrazí native notifikáciu.

5. **Bezpečnosť**:
   - `nodeIntegration: false`
   - `contextIsolation: true`
   - `sandbox: true`
   - Cudzí linky sa otvoria v systémovom prehliadači

## Prostredie

Vyžaduje:
- Node.js (>=18)
- Electron (instaluje sa cez npm)

## Súbory

- `main.mjs` — hlavný proces
- `preload.cjs` — most do DOM s contextBridge (CJS zámerne: ESM preload sa v sandboxe nenačíta)
- `package.json` — dependencies a metadata
