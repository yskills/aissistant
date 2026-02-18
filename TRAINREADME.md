# Training (einfach)

## Ziel

Flow:
1. Chatten
2. Antworten bewerten
3. `npm run train:auto -- --minCurated=20`

## Was train:auto macht

- eval gate
- export
- prepare
- LoRA-Start (wenn `ASSISTANT_LORA_ENABLED=true`)

## Wichtige ENV

```bash
ASSISTANT_LORA_ENABLED=true
ASSISTANT_LORA_API_BASE_URL=<dein-lora-endpoint>
ASSISTANT_LORA_BASE_MODEL=llama3:8b
ASSISTANT_LORA_ADAPTER_NAME=luna-adapter
ASSISTANT_LORA_ADAPTER_STRATEGY=versioned
ASSISTANT_LORA_AUTO_PROMOTE=true
```

## Adapter-Verhalten

- `versioned`: jeder Lauf neuer Adaptername
- `replace`: gleicher Adaptername wird überschrieben
- aktiver Adapter steht in `reports/training/lora-adapters.json`

## Nützliche Flags

- `--skipEval`
- `--skipLora`
- `--loraDryRun`
