# Luna UI Kit (framework-agnostisch)

Dieses Paket ist als **weitergebbares Beispiel** gedacht, damit andere Projekte den Luna-Chat-Aufbau direkt übernehmen können (HTML, Vue, React, etc.).

## Inhalt

- `assets/luna-profile.svg` – Profilbild/Avatar
- `assets/luna-icon.svg` – App/Icon-Asset (SVG)
- `luna-chat.css` – neutrales Basis-Styling
- `luna-api-client.js` – wiederverwendbarer API-Adapter für UI-Integrationen
- `luna-chat-contract.json` – API- und UI-Contract
- `INTEGRATION-DE.md` – Best-Practice Integrations-Guide
- `examples/html-snippet.html` – Vanilla-Beispiel
- `examples/vue-snippet.vue` – Vue-Beispiel

Beide Beispiele enthalten jetzt:

- Floating-Eck-Widget (FAB + Panel)
- Glass/modern UI mit Chatblasen
- Character-Picker Overlay
- Mode-Toggle (`normal` / `uncensored`)
- Gesprächsmodus-Schalter (Avatar + Voice nur dann sichtbar/aktiv)
- LocalStorage-Persistenz für Panel-State und Messages pro Character

## Warum dieser Aufbau die beste Praxis ist

- **Framework-agnostisch**: Trennung in `assets + css + contract`
- **Austauschbar**: API-Ziele (Chat/Voice/Model/Avatar) sind klar und versionierbar
- **Skalierbar**: später als eigenes npm-Paket oder Git-Submodul nutzbar
- **Konsistent**: gleiche Regeln in allen Projekten (z. B. Voice/Avatar nur im Gesprächsmodus)

## Empfohlene Verteilung

1. Variante A (schnell): Ordner `kits/luna-ui-kit` in Zielprojekt kopieren.
2. Variante B (sauber): eigenes Repo `luna-ui-kit` und per Git-Tag einbinden.
3. Variante C (am besten für viele Teams): als npm-Paket veröffentlichen.

## Einbindung im Zielprojekt

- UI: `luna-chat.css` + SVG-Assets importieren
- Logik: `luna-api-client.js` nutzen (statt verstreute `fetch`-Calls)
- Contract: Endpunkte aus `luna-chat-contract.json` versionieren
- Backend: dieses Repo liefert bereits
  - `GET /assistant/voice/providers`
  - `GET /assistant/avatars/catalog`
  - `GET/POST /assistant/voice/settings`
  - `POST /assistant/chat`
  - `POST /assistant/web-search/preview`

## Internetzugriff als Standard

Luna-Webzugriff ist im Core bereits eingebaut und sollte in Consumer-Projekten per ENV aktiviert werden:

`ASSISTANT_WEB_SEARCH_ENABLED=true`

Zusätzlich empfohlen:

- `ASSISTANT_WEB_SEARCH_CHARACTERS=luna`
- `ASSISTANT_WEB_SEARCH_MAX_ITEMS=3`
- `ASSISTANT_WEB_SEARCH_TIMEOUT_MS=9000`

Details: `INTEGRATION-DE.md`

## Lizenz-Hinweis

- Die enthaltenen SVGs (`luna-profile.svg`, `luna-icon.svg`) sind projektinterne Beispielassets und können als Vorlage weitergegeben werden.
- Für externe Avatar-Modelle (z. B. Live2D, Inochi2D Marketplace) immer die jeweilige Lizenz prüfen.
