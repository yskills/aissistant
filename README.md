# @luna/assistant-core

Minimaler Assistant-Core als Library für Chat, Memory, Training und LoRA-Orchestrierung.

## Schnellstart

Installieren:

```bash
npm install @luna/assistant-core
npm install express better-sqlite3 ollama
```

Wenn noch nicht auf npm veröffentlicht:

```bash
npm install github:yskills/aissistant#main
```

Einbinden:

```js
import { createCompanionLLMService, createAssistantRouter } from '@luna/assistant-core/v1';

const service = createCompanionLLMService();
const router = createAssistantRouter({ CompanionLLMService: service });
app.use('/assistant', router);
```

Frontend-Helper direkt importieren (kein Copy/Paste nötig):

```js
import { createAssistantApiClient } from '@luna/assistant-core/client';

const assistantApi = createAssistantApiClient({ baseUrl: '/assistant' });
await assistantApi.toggleMode({ characterId: 'luna' });
const status = await assistantApi.trainStatus(20);
```

## Training

Standard-Flow:

```bash
npm run train:auto -- --minCurated=20
```

Das enthält automatisch:
- Qualitätskontrolle (`eval:gate`)
- Datenexport (`train:export`)
- Prepare (`train:prepare`)
- LoRA-Start, wenn `ASSISTANT_LORA_ENABLED=true`

Häufige Optionen:
- `--skipEval`
- `--skipLora`
- `--loraDryRun`

## Adapter-Strategie

Empfohlen:
- `ASSISTANT_LORA_ADAPTER_STRATEGY=versioned`
- `ASSISTANT_LORA_AUTO_PROMOTE=true`

Aktiver Adapter steht in:
- `reports/training/lora-adapters.json` (`activeAdapter`)

Adapter-Pfad (default):
- `data/adapters/<adapterName>`

API zum schnellen UI-Test ohne echten Trainer:
- `POST /assistant/training/lora/example-adapter`

## Mehr Details

- Integration im Consumer: `INTEGRATION.md`
- Trainingsablauf: `TRAINREADME.md`
