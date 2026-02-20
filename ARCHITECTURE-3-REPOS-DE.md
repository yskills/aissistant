# Architektur: 3-Repo Setup (empfohlen)

## Ziel

Klare Trennung von Core-Logik, gehosteter API und UI, damit Deployments stabil und skalierbar sind.

## Repos

1. `Aissistant` (Core)
   - Paket: `@luna/assistant-core`
   - Enthält LLM/Memory/Prompts/Routen als wiederverwendbare Kernlogik

2. `luna-assistant-service` (Backend Runtime)
   - Deploybarer Service mit `/assistant/*`
   - Nutzt `@luna/assistant-core` serverseitig
   - Zuständig für CORS, API-Key, Health, Betriebs-ENV

3. `personal-luna` (Frontend)
   - Vue/PWA UI (mobile + desktop)
   - Nutzt nur API-URL (`VITE_ASSISTANT_API_BASE_URL`) und SDK
   - Keine Backend-Core-Lib im Browser

## Warum das Best Practice ist

- Entkopplung: UI und Backend unabhängig deploybar
- Sicherheit: Keine Backend-Logik im Browser
- Versionierung: Core, Service und UI können getrennt releasen
- Wiederverwendbarkeit: Mehrere UIs können denselben Service nutzen

## Lokale Entwicklung

- Service lokal starten: `npm --prefix ../luna-assistant-service run dev`
- Frontend lokal starten: `npm --prefix ../personal-luna run dev:host`
- In `personal-luna` reicht in VS Code `F5` mit `Luna Full Stack (F5)`
