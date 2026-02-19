# @luna/assistant-core

State-of-the-art AI-Companion-Core für produktive Projekte: Chat, Memory, Feedback-Learning und LoRA-Adapter-Training über eine klare API.

## Was das Projekt kann

- Companion-API mit Character-/Mode-Steuerung (`normal` / `uncensored`)
- Persistentes Memory (SQLite), Feedback-Erfassung und Training-Examples
- LoRA-Orchestrierung mit Adapter-Registry, Versionierung und Auto-Promotion
- Echten Trainingsstart direkt aus UI oder API (`Example Adapter`)
- Live-Status für Core und GPU-ML-Trainer (`provider-health`)
- Sofort nutzbar in anderen Projekten über Library-Integration

## Schnellstart

```bash
npm install
npm test
```

Danach in VS Code `F5` drücken (`Luna Dev UI (F5 + Chrome)`).

Hinweis: Standard-`F5` startet **nur** die UI (leiser Modus, ohne Trainer-Autostart).

Wenn du Trainer-Autostart willst, nutze die Launch-Config `Luna Dev UI (+ Trainer Ensure)`.

State-of-the-art On-Demand-Modus (Standard):

- LoRA-Training-Endpoints starten `lora:trainer:ensure` automatisch bei Bedarf.
- Im Alltag bleibt `F5` leichtgewichtig und leise.

Optional für den Ensure-Task:

- `ASSISTANT_SKIP_TRAINER_AUTOSTART=true` → Trainer-Autostart komplett aus
- `ASSISTANT_TRAINER_BUILD_ON_START=true` → beim Ensure zusätzlich `--build` (lauter/langsamer)
- `ASSISTANT_LORA_ENSURE_ON_DEMAND=false` → On-Demand-Ensure über API deaktivieren

## Lokaler Standard-Workflow

1. `npm install`
2. `npm test`
3. `F5` in VS Code
4. Im UI unter `Settings` auf `Example Adapter` klicken

CLI-Alternative für echten Trainingslauf (inkl. LoRA-Orchestrierung):

```bash
npm run train:luna
```

## Relevante Endpoints

- `POST /assistant/training/lora/example-adapter`
- `GET /assistant/training/lora/status?jobId=...`
- `GET /assistant/training/status?minCurated=...`
- `GET /assistant/training/lora/provider-health`

## Doku

- Training hier im Projekt: `TRAINING-GUIDE-DE.md`
- Setup in anderen Projekten: `SETUP-OTHER-PROJECTS-DE.md`
- WSL2-Ressourcen-Vorlage: `.wslconfig.example`
- Release-Workflow: `RELEASE-GUIDE-DE.md`
