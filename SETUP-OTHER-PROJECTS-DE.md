# Setup in anderen Projekten (DE)

So bindest du `@luna/assistant-core` in ein externes Projekt ein und nutzt denselben Adapter-Training-Stack wie hier.

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

ASSISTANT_LORA_ENABLED=true
ASSISTANT_LORA_API_BASE_URL=http://127.0.0.1:6060
ASSISTANT_LORA_BASE_MODEL=Qwen/Qwen2.5-0.5B-Instruct
ASSISTANT_LORA_ADAPTER_NAME=luna-adapter
ASSISTANT_LORA_ADAPTER_STRATEGY=versioned
ASSISTANT_LORA_AUTO_PROMOTE=true
```

## 4) API, die dein Projekt typischerweise nutzt

- `POST /assistant/training/lora/example-adapter` (startet echten LoRA-Trainingsjob)
- `GET /assistant/training/lora/status?jobId=...`
- `GET /assistant/training/status?minCurated=...`
- `GET /assistant/training/lora/provider-health`

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
