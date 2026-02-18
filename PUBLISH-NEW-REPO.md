# assistant-core als neues Repo veröffentlichen

Du hast bereits ein lokales Git-Repo in `assistant-core/`.

## 1) Ersten Commit machen

```bash
cd assistant-core
git add .
git commit -m "init assistant-core module"
```

## 2) Remote Repo anlegen (GitHub)
- Neues leeres Repo erstellen, z. B. `assistant-core`.

## 3) Remote verbinden und pushen

```bash
git remote add origin <DEIN_GIT_URL>
git push -u origin main
```

## 4) In Projekten updaten
Dieses Projekt nutzt bereits:
- `@luna/assistant-core` als lokale File-Dependency

Später kannst du auf Git- oder Registry-Version wechseln, z. B.:

```json
"@luna/assistant-core": "git+https://github.com/<you>/assistant-core.git#v0.1.0"
```

Dann in jedem Projekt:

```bash
npm install
```

## 5) Release-Workflow
1. Änderungen in assistant-core
2. Version erhöhen (`package.json`)
3. Tag setzen (`vX.Y.Z`)
4. In Consumer-Projekten Dependency-Version bumpen
5. `eval:gate` + Smoke-Test laufen lassen
