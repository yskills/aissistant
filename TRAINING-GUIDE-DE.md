# Training Guide (DE)

Ziel: reproduzierbares Adapter-Training mit klarer Reihenfolge, nachvollziehbaren Artefakten und Zukunftssicherheit bei Modellwechsel.

## 1) Warum im UI oft `Online (CPU)` steht

Die Anzeige basiert auf `GET /assistant/training/lora/provider-health`:

- `cudaAvailable: true` → `Aktiv (CUDA)`
- `cudaAvailable: false` → `Online (CPU)`

`Online (CPU)` bedeutet: Trainer ist erreichbar, aber ohne nutzbare CUDA-GPU im Container.

Schnelltest:

```bash
curl http://127.0.0.1:5050/assistant/training/lora/provider-health
```

Optional mit Ensure-Trigger (startet Trainer bei Bedarf vor der Health-Prüfung):

```bash
curl "http://127.0.0.1:5050/assistant/training/lora/provider-health?ensureTrainer=true"
```

## 2) Wann `prepare training` sinnvoll ist

`prepare` ist der saubere Preflight-Schritt **vor jedem echten LoRA-Submit**, wenn du Datenqualität/Volumen prüfen willst.

- Entwickeln/Feintunen: `prepare` vor jedem größeren Trainingslauf
- Kleine Iteration mit bekannt gutem Datensatz: optional überspringbar
- Modellwechsel oder neue Datenquelle: immer `prepare`

## 3) Standard-Reihenfolge (Produktiv)

1. `npm run eval:gate`
2. `npm run train:export`
3. `npm run train:prepare`
4. `npm run train:lora`

Komfort-Wrapper:

- `npm run train:auto` (allgemeiner Vollflow)
- `npm run train:luna` (Luna-Standardprofil)

## 4) Standard-Split (wie wir es jetzt machen)

Beim Export wird das kuratierte Set deterministisch in Split-Dateien geschrieben:

- `assistant-sft-curated-train.jsonl`
- `assistant-sft-curated-val.jsonl`
- `assistant-sft-curated-test.jsonl`

Default-Ratios:

- Train: `0.9`
- Val: `0.1`
- Test: `0.0`

Konfigurierbar über ENV:

- `ASSISTANT_TRAIN_VAL_RATIO` (Default `0.1`)
- `ASSISTANT_TRAIN_TEST_RATIO` (Default `0.0`)

Hinweis: Split ist deterministisch per Hash über Prompt/Antwort, damit Samples zwischen Läufen stabil im gleichen Split bleiben.

## 5) One-Command: „train luna adapter“

Standard:

```bash
npm run train:luna
```

Mit Trainer-Ensure davor:

```bash
npm run train:luna -- --ensureTrainer
```

Typische Overrides:

```bash
npm run train:luna -- --minCurated=30 --epochs=4 --learningRate=0.0001
npm run train:luna -- --datasetTier=merged --batchSize=4 --rank=32
```

`train:luna` setzt, falls nicht übergeben:

- `--adapterName=luna-adapter`
- `--adapterStrategy=versioned`
- `--datasetTier=curated`

On-Demand-Verhalten:

- Bei `POST /training/lora/start`, `.../quick-start`, `.../example-adapter` wird der Trainer standardmäßig automatisch ensured.
- Deaktivierbar über `ASSISTANT_LORA_ENSURE_ON_DEMAND=false`.

## 6) Dateien und Artefakte

Dataset-Dateien (`data/training/`):

- `assistant-sft-curated.jsonl`
- `assistant-sft-curated-train.jsonl`
- `assistant-sft-curated-val.jsonl`
- `assistant-sft-curated-test.jsonl`
- `assistant-sft-memory.jsonl`
- `assistant-sft.jsonl`
- `assistant-sft-summary.json`

LoRA-Reports:

- `reports/training/lora-latest.json`
- `reports/training/lora-adapters.json`
- `data/adapters/<adapterName>/`

## 7) Modellwechsel, aber Wissen behalten

Wichtig: Das **dauerhafte Wissen** liegt in deinen Trainingsdaten (DB/Memory → Export), nicht nur im einzelnen Adapter.

Standardstrategie:

1. Datenbasis pflegen (`train:export` aus persistierten Beispielen)
2. Adapter versioniert trainieren (`adapterStrategy=versioned`)
3. Registry als Verlauf nutzen (`lora-adapters.json`)
4. Beim Modellwechsel denselben Export auf neues `baseModel` trainieren

So bleibt gelerntes Verhalten portierbar, selbst wenn sich das Base-Model ändert.

### Adapter auf Adapter?

Im aktuellen Standardflow trainieren wir **nicht** „Adapter auf Adapter“, sondern immer auf ein Base-Model mit frischem LoRA-Lauf. Das ist stabiler und besser vergleichbar.

### Merge später möglich?

Ja. Ein späteres LoRA-Merge ins Basismodell ist möglich (Deployment-Optimierung), bleibt aber bewusst ein separater Schritt.

## 8) Laptop generell schneller/leiser (Windows + Docker)

Prio-Reihenfolge mit großem Effekt:

1. Normales `F5` nutzen (ohne Trainer-Autostart)
2. Docker Desktop: Resource Saver aktivieren
3. Unnötige Startup-Apps deaktivieren
4. WSL2-Ressourcen deckeln via `.wslconfig`
5. Nur bei Bedarf Trainer/GPU aktiv starten

Beispiel `%UserProfile%\\.wslconfig`:

```ini
[wsl2]
memory=8GB
processors=4
swap=8GB
```

Danach anwenden:

```bash
wsl --shutdown
```

## 9) Relevante API-Endpoints

- `POST /assistant/training/lora/example-adapter`
- `GET /assistant/training/lora/status?jobId=...`
- `GET /assistant/training/status?minCurated=...`
- `GET /assistant/training/lora/provider-health`
