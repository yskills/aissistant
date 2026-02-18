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
- `GET /assistant/training/lora/status?jobId=...`
- `GET /assistant/training/status?minCurated=20` (neu: aggregierter Status)

`/training/status` liefert dir in einem Call:

- `curatedCount`, `minCurated`, `canAutoTrain`
- letzten Eval-Status (`overallPassed`)
- letzten LoRA-Report
- aktiven Adapter (`activeAdapter`)

Damit kannst du Buttons visuell steuern (`disabled/loading/success/error`) und Logs anzeigen.

## Frontend Helper (copy/paste)

```js
const base = '/assistant';

async function api(path, method = 'GET', body = null) {
	const response = await fetch(`${base}${path}`, {
		method,
		headers: { 'Content-Type': 'application/json' },
		body: body ? JSON.stringify(body) : undefined,
	});
	const json = await response.json().catch(() => ({}));
	if (!response.ok || json?.ok === false) {
		throw new Error(json?.error?.message || `HTTP ${response.status}`);
	}
	return json;
}

export async function getMode(characterId = 'luna') {
	return api(`/mode?characterId=${encodeURIComponent(characterId)}`);
}

export async function setMode({ characterId = 'luna', mode = 'normal', password = '' } = {}) {
	return api('/mode', 'POST', { characterId, mode, password });
}

export async function toggleMode({ characterId = 'luna', password = '' } = {}) {
	const current = await getMode(characterId);
	const nextMode = current.mode === 'normal' ? 'uncensored' : 'normal';
	return setMode({ characterId, mode: nextMode, password });
}

export async function trainPrepare() {
	return api('/training/prepare', 'POST', {});
}

export async function trainAuto(minCurated = 20) {
	return api('/training/auto', 'POST', { minCurated });
}

export async function trainLoraStart(payload = {}) {
	return api('/training/lora/start', 'POST', payload);
}

export async function trainLoraStatus(jobId = '') {
	const q = jobId ? `?jobId=${encodeURIComponent(jobId)}` : '';
	return api(`/training/lora/status${q}`);
}

export async function trainStatus(minCurated = 20) {
	return api(`/training/status?minCurated=${encodeURIComponent(minCurated)}`);
}
```

UI-State-Logik (Beispiel):

- `trainAutoButton.disabled = !status.training.canAutoTrain`
- `evalBadge = status.training.eval.overallPassed ? 'green' : 'red'`
- `activeAdapter = status.training.lora.activeAdapter`
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
