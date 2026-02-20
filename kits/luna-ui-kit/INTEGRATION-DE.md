# Luna UI Kit Integration (Best Way)

## Ziel

Einmal integrieren und in **allen Projekten gleich** nutzen (Vue/React/HTML), ohne jedes Mal UI und API neu zu bauen.

## Empfohlener Weg (Best Practice)

1. `luna-ui-kit` als eigenes Paket/Repo versionieren.
2. In jedem Projekt nur:
   - `luna-chat.css` importieren,
   - `luna-api-client.js` verwenden,
   - deine Framework-View (Vue/React/HTML) auf denselben Contract mappen.
3. Assistant-Backend immer unter `/assistant` bereitstellen.

## Was du übernehmen musst

- **Ja, CSS muss übernommen/importiert werden** (oder in dein Designsystem gemappt).
- **Assets** (`luna-profile.svg`, `luna-icon.svg`) importieren oder per URL ersetzen.
- **API-Adapter** (`luna-api-client.js`) nutzen statt direkte `fetch`-Strings überall.

## Was im Backend Standard sein sollte

- `POST /assistant/chat`
- `GET/POST /assistant/voice/settings`
- `GET /assistant/voice/providers`
- `GET /assistant/avatars/catalog`
- `GET /assistant/luna/presets`
- `POST /assistant/luna/presets/apply`
- `POST /assistant/web-search/preview` (optional fürs UI-Badge)

## Luna Presets im Beispiel setzen (Tsundere + Uncensored expliziter)

Empfohlene Preset-IDs:

- normal: `luna-tsundere`
- uncensored: `luna-uncensored-explicit`

Direkt per API anwenden:

```bash
curl -X POST http://127.0.0.1:5050/assistant/luna/presets/apply \
   -H "Content-Type: application/json" \
   -d '{"characterId":"luna","presetId":"luna-tsundere","mode":"normal"}'

curl -X POST http://127.0.0.1:5050/assistant/luna/presets/apply \
   -H "Content-Type: application/json" \
   -d '{"characterId":"luna","presetId":"luna-uncensored-explicit","mode":"uncensored"}'
```

Im Vue-Beispiel (`examples/vue-snippet.vue`) ist dieses Umschalten bereits eingebaut: bei Mode-Wechsel wird automatisch das passende Preset angewendet.

## Wichtig: Mode-Wechsel vs. Character-Wechsel

- `normal`/`uncensored` **ändert nicht automatisch den Character**.
- Character bleibt gleich, bis du ihn explizit wechselst (z. B. `setCharacter`/Character-Picker).
- Ausnahme: Wenn `ASSISTANT_FORCE_CHARACTER_ID=luna` gesetzt ist, wird immer Luna erzwungen.

## Wo ist Lunas vordefinierte JSON?

Im Projekt liegt die aktive Datei unter:

- `config/assistant-mode-config.local.json`

Für externe Projekte setzt du den Pfad über ENV:

```env
ASSISTANT_MODE_CONFIG_FILE=./config/assistant-mode-config.local.json
```

Und startest mit der gleichen Struktur (oder aus `config/assistant-mode-config.example.json` ableiten).

## Ja, im Fremdprojekt geht alles per Config + Extra-Calls

Typische Runtime-Calls:

- `POST /assistant/mode` (normal/uncensored)
- `POST /assistant/luna/presets/apply` (tsundere, uncensored-explicit)
- `POST /assistant/mode-extras` (zusätzliche uncensored instructions/memories)
- `POST /assistant/voice/settings` (Voice/PFP/Provider)

## Internetzugriff (Luna Web) als Standard

Im Core bereits vorhanden, aber per ENV steuerbar.

Empfohlene Default-ENV pro Projekt:

```env
ASSISTANT_WEB_SEARCH_ENABLED=true
ASSISTANT_WEB_SEARCH_CHARACTERS=luna
ASSISTANT_WEB_SEARCH_MAX_ITEMS=3
ASSISTANT_WEB_SEARCH_TIMEOUT_MS=9000
```

## Wichtig

- **Standardfunktion**: Ja, Webzugriff ist im Core implementiert.
- **Pro Projekt festlegen**: Ebenfalls ja, über ENV (bewusst so für Kontrolle/Sicherheit).
- Du musst den Web-Stack nicht neu bauen, nur ENV sauber setzen.
