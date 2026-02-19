import test from 'node:test';
import assert from 'node:assert/strict';
import createAssistantServiceApp from '../src/service/createAssistantServiceApp.js';

function createMockCompanionService() {
  const state = {
    mode: 'normal',
    characterId: 'luna',
    character: 'Luna',
    tone: 'warm',
    modeExtras: {
      uncensoredInstructions: [],
      uncensoredMemories: [],
    },
    memoryOverview: {
      historyCount: 2,
      uncensoredHistoryCount: 0,
      goalsCount: 1,
      notesCount: 1,
      pinnedMemoriesCount: 1,
    },
  };

  const buildModeState = () => ({
    mode: state.mode,
    character: state.character,
    characterId: state.characterId,
    tone: state.tone,
    characterDefinition: {
      id: state.characterId,
      name: state.character,
      definition: {
        domain: 'personal',
        modeProfiles: {
          normal: { mission: 'daily planning' },
          uncensored: { mission: 'companion context' },
        },
      },
    },
    profile: {
      modeExtras: state.modeExtras,
      preferredName: 'Tester',
    },
  });

  return {
    isEnabled: () => true,
    getMode: () => buildModeState(),
    setMode: (_userId, mode) => {
      state.mode = String(mode || 'normal').toLowerCase() === 'uncensored' ? 'uncensored' : 'normal';
      return buildModeState();
    },
    getSettings: () => ({
      llmEnabled: true,
      mode: state.mode,
      memoryOverview: state.memoryOverview,
    }),
    updateSettings: () => ({
      llmEnabled: true,
      mode: state.mode,
      memoryOverview: state.memoryOverview,
    }),
    resetAllState: () => ({ profile: { preferredName: '', modeExtras: state.modeExtras } }),
    pruneMemoryByDays: () => state.memoryOverview,
    deleteMemoryByDate: () => state.memoryOverview,
    deleteRecentMemoryDays: () => state.memoryOverview,
    deleteMemoryByTag: () => state.memoryOverview,
    deleteSingleMemoryItem: () => state.memoryOverview,
    setPreferredName: (_userId, preferredName) => ({ profile: { preferredName: preferredName || '' } }),
    setModeExtras: (_userId, { instructions = [], memories = [] } = {}) => {
      state.modeExtras = {
        uncensoredInstructions: Array.isArray(instructions) ? instructions : [],
        uncensoredMemories: Array.isArray(memories) ? memories : [],
      };
      return {
        modeExtras: state.modeExtras,
        profile: {
          modeExtras: state.modeExtras,
        },
      };
    },
    getWebSearchPreview: (_userId, message) => ({
      query: String(message || ''),
      enabled: true,
      snippets: [],
    }),
    addMessageFeedback: () => ({ accepted: true }),
    addTrainingExample: () => ({ id: 'example-1', accepted: true }),
    chat: async ({ message }) => ({
      ...buildModeState(),
      reply: `echo:${String(message || '')}`,
      llmEnabled: true,
      meta: { webSearchUsed: false },
      profile: { preferredName: 'Tester', modeExtras: state.modeExtras },
    }),
    getCharacterDefinitions: () => ({
      defaultCharacterId: 'luna',
      characters: [
        { id: 'luna', name: 'Luna', note: 'Default' },
        { id: 'eva', name: 'Eva', note: 'Trading' },
      ],
    }),
  };
}

async function startTestServer() {
  const app = createAssistantServiceApp({
    CompanionService: createMockCompanionService(),
    mountPath: '/assistant',
    enableCors: false,
  });

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    baseUrl,
    stop: async () => {
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    },
  };
}

async function apiRequest(baseUrl, path, { method = 'GET', body = null } = {}) {
  const response = await fetch(`${baseUrl}/assistant${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
    },
    body: body == null ? undefined : JSON.stringify(body),
  });

  const json = await response.json().catch(() => ({}));
  return {
    status: response.status,
    ok: response.ok,
    json,
  };
}

test('assistant API contracts: core read/write routes', async () => {
  const { baseUrl, stop } = await startTestServer();

  try {
    const mode = await apiRequest(baseUrl, '/mode?characterId=luna');
    assert.equal(mode.status, 200);
    assert.equal(mode.json.ok, true);
    assert.equal(mode.json.mode, 'normal');

    const modeWrite = await apiRequest(baseUrl, '/mode', {
      method: 'POST',
      body: { characterId: 'luna', mode: 'uncensored' },
    });
    assert.equal(modeWrite.status, 200);
    assert.equal(modeWrite.json.mode, 'uncensored');

    const settings = await apiRequest(baseUrl, '/settings?characterId=luna');
    assert.equal(settings.status, 200);
    assert.equal(settings.json.ok, true);
    assert.equal(typeof settings.json.settings, 'object');

    const profile = await apiRequest(baseUrl, '/profile', {
      method: 'POST',
      body: { characterId: 'luna', preferredName: 'Integration User' },
    });
    assert.equal(profile.status, 200);
    assert.equal(profile.json.ok, true);

    const brief = await apiRequest(baseUrl, '/brief?characterId=luna');
    assert.equal(brief.status, 200);
    assert.equal(brief.json.ok, true);
    assert.equal(typeof brief.json.brief, 'object');

    const chat = await apiRequest(baseUrl, '/chat', {
      method: 'POST',
      body: { characterId: 'luna', message: 'Hallo' },
    });
    assert.equal(chat.status, 200);
    assert.equal(chat.json.ok, true);
    assert.equal(typeof chat.json.reply, 'string');

    const chars = await apiRequest(baseUrl, '/characters');
    assert.equal(chars.status, 200);
    assert.equal(chars.json.ok, true);
    assert.equal(Array.isArray(chars.json.characters), true);
  } finally {
    await stop();
  }
});

test('assistant API contracts: memory/training/lora routes are reachable', async () => {
  const { baseUrl, stop } = await startTestServer();

  try {
    const memoryDelete = await apiRequest(baseUrl, '/memory/delete-recent', {
      method: 'POST',
      body: { characterId: 'luna', mode: 'normal', days: 7 },
    });
    assert.equal(memoryDelete.status, 200);
    assert.equal(memoryDelete.json.ok, true);

    const feedback = await apiRequest(baseUrl, '/feedback', {
      method: 'POST',
      body: {
        characterId: 'luna',
        mode: 'normal',
        value: 'up',
        userMessage: 'u',
        assistantMessage: 'a',
      },
    });
    assert.equal(feedback.status, 200);
    assert.equal(feedback.json.ok, true);

    const trainingExample = await apiRequest(baseUrl, '/training/example', {
      method: 'POST',
      body: {
        characterId: 'luna',
        mode: 'normal',
        source: 'contract-test',
        accepted: true,
        user: 'u',
        assistant: 'a',
      },
    });
    assert.equal(trainingExample.status, 200);
    assert.equal(trainingExample.json.ok, true);

    const trainingStatus = await apiRequest(baseUrl, '/training/status?minCurated=1');
    assert.equal(trainingStatus.status, 200);
    assert.equal(trainingStatus.json.ok, true);
    assert.equal(typeof trainingStatus.json.training, 'object');

    const loraConfig = await apiRequest(baseUrl, '/training/lora/config');
    assert.equal(loraConfig.status, 200);
    assert.equal(loraConfig.json.ok, true);

    const loraHealth = await apiRequest(baseUrl, '/training/lora/provider-health');
    assert.equal(loraHealth.status, 200);
    assert.equal(loraHealth.json.ok, true);
    assert.equal(typeof loraHealth.json.provider, 'object');

    const loraStatus = await apiRequest(baseUrl, '/training/lora/status');
    assert.equal(loraStatus.status, 200);
    assert.equal(loraStatus.json.ok, true);
    assert.equal(typeof loraStatus.json.lora, 'object');
  } finally {
    await stop();
  }
});
