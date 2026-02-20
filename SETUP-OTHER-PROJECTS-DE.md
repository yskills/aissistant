# Setup in anderen Projekten (DE)

So bindest du `@luna/assistant-core` in ein externes Projekt ein und nutzt denselben Adapter-Training-Stack wie hier.

## 0) 5-Minuten Setup (Copy/Paste)

```bash
npm install express better-sqlite3 ollama
npm install github:yskills/aissistant#v0.1.7
mkdir -p config
cp node_modules/@luna/assistant-core/config/assistant-mode-config.example.json config/assistant-mode-config.local.json
cp node_modules/@luna/assistant-core/config/luna-presets.example.json config/luna-presets.local.json
```

Dann in `.env`:

```env
ASSISTANT_MODE_CONFIG_FILE=./config/assistant-mode-config.local.json
LLM_PROVIDER=ollama
LLM_MODEL=luna:latest
ASSISTANT_FORCE_CHARACTER_ID=luna
ASSISTANT_UNCENSORED_PASSWORD=change-this-now
```

Preset-Flow (normal + uncensored) aus `config/luna-presets.local.json`:

1. `POST /assistant/mode`
2. `POST /assistant/luna/presets/apply`

## 1) Installation

```bash
npm install express better-sqlite3 ollama
```

Über GitHub-Tag installieren (Standard):

```bash
npm install github:yskills/aissistant#v0.1.4
```

## 1.1) Empfohlener Ablauf im Consumer-Projekt

```bash
npm install
npm test
```

Danach Service starten (z. B. mit deinem Dev-Startscript) und Endpunkte prüfen.

## 2) Backend einbinden

```js
import { createCompanionLLMService, createAssistantRouter } from '@luna/assistant-core/v1';

const service = createCompanionLLMService();
const router = createAssistantRouter({ CompanionLLMService: service });
app.use('/assistant', router);
```

## 3) Minimal-ENV im Consumer

```bash
ASSISTANT_BASE_DIR=.
ASSISTANT_MODE_CONFIG_FILE=./config/assistant-mode-config.local.json
ASSISTANT_MEMORY_FILE=./data/assistant-memory.sqlite
LLM_PROVIDER=ollama
LLM_MODEL=luna:latest
ASSISTANT_FORCE_CHARACTER_ID=luna
ASSISTANT_UNCENSORED_PASSWORD=change-this-now

ASSISTANT_LORA_ENABLED=true
ASSISTANT_LORA_API_BASE_URL=http://127.0.0.1:6060
ASSISTANT_LORA_BASE_MODEL=meta-llama/Meta-Llama-3.1-8B-Instruct
ASSISTANT_LORA_ADAPTER_NAME=luna-adapter
ASSISTANT_LORA_ADAPTER_STRATEGY=versioned
ASSISTANT_LORA_AUTO_PROMOTE=true
```

## 4) API, die dein Projekt typischerweise nutzt

- `POST /assistant/training/lora/example-adapter` (startet echten LoRA-Trainingsjob)
- `GET /assistant/training/lora/status?jobId=...`
- `GET /assistant/training/status?minCurated=...`
- `GET /assistant/training/lora/provider-health`
- `GET /assistant/luna/presets`
- `POST /assistant/luna/presets/apply`
- `POST /assistant/luna/ingest` (Lernen aus externen Endpoints/Events)

## 5) Empfohlenes Projekt-Setup

- Core-API in der App (Node/Express)
- zentraler LoRA-Trainer-Service über `ASSISTANT_LORA_API_BASE_URL`
- Adapter-Strategie `versioned` + `autoPromote`
- getrennte Umgebungen mit eigenem Adapter-Namensraum

## 6) Kurztest im Consumer

1. Service starten
2. `POST /assistant/training/lora/example-adapter`
3. `GET /assistant/training/lora/status?jobId=...`
4. `GET /assistant/training/status?minCurated=...`

## 7) Skalierbarer Aufbau (empfohlen)

- Assistant-Core als eigenständiges API-Modul im Consumer halten (`/assistant` Router)
- LoRA-Trainer als separates Service-Deployment anbinden (`ASSISTANT_LORA_API_BASE_URL`)
- CI im Consumer ebenfalls auf `npm test` + API-Contract-Checks setzen

## 8) Luna-UI-Assets weitergeben (HTML/Vue/React)

Ja, dafür ist der Ordner `kits/luna-ui-kit` gedacht.

Enthalten:

- `assets/luna-profile.svg` (Avatar/Profilbild)
- `assets/luna-icon.svg` (Icon)
- `luna-chat.css` (framework-agnostisches Basis-Styling)
- `luna-chat-contract.json` (klare API-Zuordnung: Chat/Voice/Model/Avatar)
- `examples/html-snippet.html`
- `examples/vue-snippet.vue`

Empfohlene Verteilung:

1. Schnellstart: Ordner in Zielprojekt kopieren.
2. Team-Setup: eigenen `luna-ui-kit`-Repo-Ordner versionieren.
3. Multi-Projekt-Setup: als npm-Paket veröffentlichen.

Wichtig für Konsistenz:

- Avatar nur im Gesprächsmodus anzeigen.
- Sprache nur im Gesprächsmodus aktivieren.
- Modellbindung im Backend über ENV (`LLM_MODEL=luna:latest`) zentral halten.

## 9) Wo du Lunas Art/Charakter definierst

Primär in:

- `config/assistant-mode-config.local.json`
	- `assistantProfile` (vibe, appearance, traits)
	- `characterBlueprint` (speechStyle, emotionalRules)
	- `characterProfiles.luna.tones`
	- `characterProfiles.luna.definition.assistantProfile`

Preset-Mapping für App-Logik (empfohlen):

- `config/luna-presets.local.json` (aus `config/luna-presets.example.json` kopieren)
	- mappt `normal` -> `luna-tsundere`
	- mappt `uncensored` -> `luna-uncensored-explicit`
	- dokumentiert Passwort-Lock für uncensored Mode

Schneller Test per API-Preset:

```bash
curl -X POST http://127.0.0.1:5050/assistant/luna/presets/apply \
	-H "Content-Type: application/json" \
	-d '{"presetId":"luna-cute-egirl"}'
```
