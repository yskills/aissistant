# Release Guide (DE)

Kurzworkflow für `@luna/assistant-core`.

## Standardablauf

1. Code ändern
2. Lokal prüfen
3. Version erhöhen (SemVer)
4. Git push + Tag push

## 1) Code ändern

Arbeite normal im Feature/Fix.

## 2) Lokal prüfen

```bash
npm install
npm test
```

Optional Cleanup vor Release:

```bash
npm run clean:temp
```

## 3) Version erhöhen

Automatisch mit Checks:

```bash
npm run release:patch
# oder
npm run release:minor
# oder
npm run release:major
```

Das macht:

- `clean:temp`
- `npm test`
- `npm pack --dry-run`
- `npm version ...` (ändert `package.json`, erstellt Git-Commit + Git-Tag)

## 4) Pushen

```bash
git push origin main
git push --tags
```

Oder als Shortcut:

```bash
npm run release:push
```

Komplett in einem Schritt (ohne npm publish):

```bash
npm run release:full:patch
```

## Worauf du achten musst

- Arbeitsbaum muss sauber sein vor `npm version`.
- Version nach SemVer wählen:
  - `patch`: Bugfix, keine Breaking Changes
  - `minor`: neue Features, rückwärtskompatibel
  - `major`: Breaking Changes
- Bei API-Änderungen kurz Changelog/README aktualisieren.
- Vor dem Tag-Push sicherstellen, dass `files` in `package.json` nur gewünschte Inhalte enthält.
