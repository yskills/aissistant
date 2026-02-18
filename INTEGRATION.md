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

## Mode Toggle (normal/uncensored)

Ja, uncensored mode ist vorhanden und per API toggelbar.

Endpoints:

- `GET /assistant/mode?characterId=luna`
- `POST /assistant/mode`

Body für Toggle:

```json
{
	"characterId": "luna",
	"mode": "uncensored",
	"password": "<nur falls ASSISTANT_UNCENSORED_PASSWORD gesetzt ist>"
}
```

Hinweis: Bei gesetztem Passwort ist Rate-Limiting aktiv.

## Training Buttons + visuelle States/Logs

Nutze diese Endpoints für UI-Buttons:

- `POST /assistant/training/prepare`
- `POST /assistant/training/auto`
- `POST /assistant/training/lora/start`
- `POST /assistant/training/lora/example-adapter` (neu: erzeugt lokalen Beispiel-Adapter)
- `GET /assistant/training/lora/status?jobId=...`
- `GET /assistant/training/status?minCurated=20` (neu: aggregierter Status)

`/training/status` liefert dir in einem Call:

- `curatedCount`, `minCurated`, `canAutoTrain`
- letzten Eval-Status (`overallPassed`)
- letzten LoRA-Report
- aktiven Adapter (`activeAdapter`)
- Adapter-Pfade (`adapterPaths.adapterOutputDir`, `adapterPaths.activeAdapterPath`)

Damit kannst du Buttons visuell steuern (`disabled/loading/success/error`) und Logs anzeigen.

## Wo landet der Adapter?

Standard:

- `<ASSISTANT_BASE_DIR>/data/adapters/<adapterName>`

Wenn gesetzt:

- `ASSISTANT_LORA_OUTPUT_DIR/<adapterName>`

Verlässliche Quelle für UI/Logs:

- `GET /assistant/training/status`
- `training.lora.adapterPaths.activeAdapterPath`
- `training.lora.adapterPaths.latestExpectedAdapterPath`

## Frontend Helper (direkt importieren)

```js
import { createAssistantApiClient } from '@luna/assistant-core/client';

const assistantApi = createAssistantApiClient({ baseUrl: '/assistant' });

await assistantApi.toggleMode({ characterId: 'luna' });
await assistantApi.trainPrepare();
await assistantApi.trainAuto(20);
await assistantApi.createExampleAdapter({ promote: true });

const status = await assistantApi.trainStatus(20);
console.log(status.training.lora.adapterPaths.activeAdapterPath);
```

UI-State-Logik (Beispiel):

- `trainAutoButton.disabled = !status.training.canAutoTrain`
- `evalBadge = status.training.eval.overallPassed ? 'green' : 'red'`
- `activeAdapter = status.training.lora.activeAdapter`
- `activeAdapterPath = status.training.lora.adapterPaths.activeAdapterPath`
- `logPanel = JSON.stringify(status.training, null, 2)`

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
