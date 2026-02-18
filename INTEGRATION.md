# Integration (Produktion)

## Entscheidung

Nutze dieses Repo als Library. Kein Fork nötig.

## Installation im Consumer

Option 1 (sofort):

```bash
npm install github:yskills/aissistant#main
npm install express better-sqlite3 ollama
```

Option 2 (nach npm publish):

```bash
npm install @luna/assistant-core@<version>
npm install express better-sqlite3 ollama
```

## Einbau

```js
import { createCompanionLLMService, createAssistantRouter } from '@luna/assistant-core/v1';

const service = createCompanionLLMService();
const router = createAssistantRouter({ CompanionLLMService: service });
app.use('/assistant', router);
```

## Minimale ENV im Consumer

```bash
ASSISTANT_BASE_DIR=.
ASSISTANT_MODE_CONFIG_FILE=./config/assistant-mode-config.local.json
ASSISTANT_MEMORY_FILE=./data/assistant-memory.sqlite
ASSISTANT_LORA_ENABLED=true
ASSISTANT_LORA_API_BASE_URL=<dein-lora-endpoint>
ASSISTANT_LORA_BASE_MODEL=llama3:8b
ASSISTANT_LORA_ADAPTER_NAME=luna-adapter
ASSISTANT_LORA_ADAPTER_STRATEGY=versioned
ASSISTANT_LORA_AUTO_PROMOTE=true
```

## Update-Flow

1. Neue Version dieses Repos veröffentlichen.
2. Im Consumer `npm install @luna/assistant-core@<neue-version>`.
3. Kurz prüfen mit `npm run smoke:core` im Core-Repo und einem API-Smoketest im Consumer.
