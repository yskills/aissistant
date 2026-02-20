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
- `POST /assistant/web-search/preview` (optional fürs UI-Badge)

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
