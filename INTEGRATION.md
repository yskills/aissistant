# Integration und Updates für assistant-core

## Ziel
assistant-core soll in mehreren Projekten wiederverwendet werden und zentral versioniert werden.

## Empfohlener Weg (nach dem Auskoppeln in eigenes Git-Repo)

1. assistant-core als eigenes Repo pushen.
2. Version erhöhen (z. B. 0.1.0 -> 0.2.0) bei Änderungen.
3. In Zielprojekten als Dependency einbinden:
   - per Git-Tag/Commit
   - oder per npm Registry (privat/öffentlich)

## Update-Workflow für Projekte

1. Neue Version im assistant-core Repo taggen.
2. In jedem Projekt Dependency-Version aktualisieren.
3. Install ausführen.
4. Kurztest: eval gate + smoke test.

## Solange alles noch im selben Workspace ist

Aktuell nutzt backend Wrapper-Dateien, die auf assistant-core zeigen:
- backend/src/services/CompanionLLMService.js
- backend/src/routes/assistantRoutes.js

Damit bleibt alles kompatibel, während du assistant-core weiterentwickelst.

## Minimaler Qualitäts-Check vor Release

1. npm --prefix backend run eval:gate
2. npm --prefix backend run train:auto -- --minCurated=20
3. Frontend Lint/Smoke

Wenn das grün ist, kannst du release/tag sicher machen.
