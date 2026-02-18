# @luna/assistant-core

Reusable assistant core module (Luna/Eva) for integration into multiple projects.

## Contains
- Assistant service orchestration (`CompanionLLMService`)
- Assistant API router factory (`createAssistantRouter`)
- Memory, prompt, eval, and training helpers used by the assistant runtime

## Learning / Training scripts (source of truth)
- `npm run eval:gate`
- `npm run train:export`
- `npm run train:prepare`
- `npm run train:auto -- --minCurated=20`

## Integration (local workspace)

Use from Node apps by importing:

```js
import CompanionLLMService from '../assistant-core/src/services/CompanionLLMService.js';
import createAssistantRouter from '../assistant-core/src/routes/assistantRoutes.js';
```

## Versioning
- Increase `version` in `package.json` when behavior changes.
- Publish to a git repo or npm registry to consume from other projects.

## Migration strategy
1. Keep host project wrappers stable.
2. Move feature work into `assistant-core` first.
3. Update wrappers/imports in host projects.
