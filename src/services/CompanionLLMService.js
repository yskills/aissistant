import MemoryManager from './assistant/MemoryManager.js';
import PromptBuilder from './assistant/PromptBuilder.js';
import LLMClient from './assistant/LLMClient.js';
import StateStoreFactory from './assistant/storage/StateStoreFactory.js';
import MemorySchemaManager from './assistant/MemorySchemaManager.js';
import ModeConfigRepository from './assistant/ModeConfigRepository.js';
import { resolveRuntimeConfig } from '../config/runtimeConfig.js';

export class CompanionLLMService {
  constructor({ env = process.env, cwd = process.cwd(), runtime = {} } = {}) {
    this.env = env;
    this.runtime = {
      ...resolveRuntimeConfig({ env, cwd }),
      ...(runtime || {}),
    };

    this.provider = (env.LLM_PROVIDER || 'ollama').toLowerCase();
    this.model = env.LLM_MODEL || env.OPENAI_MODEL || 'llama3.1:8b';
    this.ollamaHost = env.OLLAMA_HOST || 'http://127.0.0.1:11434';
    this.openaiBaseUrl = env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
    this.openaiApiKey = env.OPENAI_API_KEY || '';
    this.webSearchEnabled = ['1', 'true', 'yes', 'on'].includes(String(env.ASSISTANT_WEB_SEARCH_ENABLED || '').toLowerCase());
    this.webSearchCharacterIds = String(env.ASSISTANT_WEB_SEARCH_CHARACTERS || 'luna')
      .split(',')
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean);
    this.webSearchMaxItems = Number(env.ASSISTANT_WEB_SEARCH_MAX_ITEMS || 3);

    this.historyWindow = Number(env.LLM_HISTORY_WINDOW || 10);
    this.historyStoreLimit = Number(env.LLM_HISTORY_STORE_LIMIT || 40);
    this.notesLimit = Number(env.LLM_NOTES_LIMIT || 10);

    this.historyRetentionDays = Number(env.LLM_HISTORY_RETENTION_DAYS || 45);
    this.summaryChunkSize = Number(env.LLM_SUMMARY_CHUNK_SIZE || 20);
    this.summaryLimit = Number(env.LLM_SUMMARY_LIMIT || 24);
    this.summaryContextWindow = Number(env.LLM_SUMMARY_CONTEXT_WINDOW || 4);
    this.maxMessageChars = Number(env.LLM_MAX_MESSAGE_CHARS || 1200);
    this.memoryQualityThreshold = Number(env.LLM_MEMORY_QUALITY_THRESHOLD || 0.55);
    this.memoryMinLength = Number(env.LLM_MEMORY_MIN_LENGTH || 10);
    this.memoryMaxLength = Number(env.LLM_MEMORY_MAX_LENGTH || 180);
    this.memoryDecayDays = Number(env.LLM_MEMORY_DECAY_DAYS || 30);
    this.memoryForgetThreshold = Number(env.LLM_MEMORY_FORGET_THRESHOLD || 0.35);

    this.allowedModes = ['normal', 'uncensored'];
    this.memoryBackend = 'sqlite';
    if (String(env.MEMORY_BACKEND || 'sqlite').toLowerCase() !== 'sqlite') {
      throw new Error('Only MEMORY_BACKEND=sqlite is supported. JSON fallback is disabled.');
    }
    this.memoryStore = this.createMemoryStore();
    this.memorySchemaManager = new MemorySchemaManager({ currentVersion: 2 });
    this.modeConfigRepository = new ModeConfigRepository({
      configFilePath: this.runtime.modeConfigFile,
      allowedModes: this.allowedModes,
    });

    this.memoryManager = new MemoryManager({
      loadMemory: this.loadMemory.bind(this),
      saveMemory: this.saveMemory.bind(this),
      loadModeConfig: this.loadModeConfig.bind(this),
      normalizeMode: this.normalizeMode.bind(this),
      notesLimit: this.notesLimit,
      historyStoreLimit: this.historyStoreLimit,
      historyRetentionDays: this.historyRetentionDays,
      summaryChunkSize: this.summaryChunkSize,
      summaryLimit: this.summaryLimit,
      memoryQualityThreshold: this.memoryQualityThreshold,
      memoryMinLength: this.memoryMinLength,
      memoryMaxLength: this.memoryMaxLength,
      memoryDecayDays: this.memoryDecayDays,
      memoryForgetThreshold: this.memoryForgetThreshold,
    });

    this.promptBuilder = new PromptBuilder({
      normalizeMode: this.normalizeMode.bind(this),
      getModeConfig: this.getModeConfig.bind(this),
      loadModeConfig: this.loadModeConfig.bind(this),
      summaryContextWindow: this.summaryContextWindow,
    });

    this.llmClient = new LLMClient({
      provider: this.provider,
      model: this.model,
      ollamaHost: this.ollamaHost,
      openaiBaseUrl: this.openaiBaseUrl,
      openaiApiKey: this.openaiApiKey,
      buildSystemPrompt: this.buildSystemPrompt.bind(this),
      temperature: 0.72,
      topP: 0.9,
      webSearchEnabled: this.webSearchEnabled,
      webSearchCharacterIds: this.webSearchCharacterIds,
      webSearchMaxItems: this.webSearchMaxItems,
    });
  }

  normalizeMode(mode) {
    const value = (mode || '').toLowerCase();
    return this.allowedModes.includes(value) ? value : 'normal';
  }

  normalizeCharacterId(characterId, modeConfigFromFile = null) {
    const loaded = modeConfigFromFile || this.loadModeConfig();
    const value = String(characterId || '').trim().toLowerCase();
    if (value && loaded.characterProfiles[value]) {
      return value;
    }
    return loaded.assistant.defaultCharacterId;
  }

  getCharacterProfile(characterId = null, modeConfigFromFile = null) {
    const loaded = modeConfigFromFile || this.loadModeConfig();
    const id = this.normalizeCharacterId(characterId, loaded);
    return {
      id,
      ...loaded.characterProfiles[id],
    };
  }

  getModeConfig(mode = 'normal', modeConfigFromFile = null, characterId = null) {
    const normalized = this.normalizeMode(mode);
    const loaded = modeConfigFromFile || this.loadModeConfig();
    const assistant = loaded.assistant;
    const characterProfile = this.getCharacterProfile(characterId, loaded);

    return {
      mode: normalized,
      character: characterProfile.name,
      characterId: characterProfile.id,
      tone: characterProfile.tones[normalized],
      characterDefinition: characterProfile,
      language: assistant.language,
    };
  }

  getCharacterDefinitions() {
    const loaded = this.loadModeConfig();
    return {
      defaultCharacterId: loaded.assistant.defaultCharacterId,
      characters: Object.values(loaded.characterProfiles),
    };
  }

  getWebSearchPreview(userId = 'default', message = '') {
    const { user } = this.memoryManager.getUserState(userId);
    return this.llmClient.previewWebSearch(user, message);
  }

  addMessageFeedback(userId = 'default', payload = {}) {
    const { memory, user } = this.memoryManager.getUserState(userId);
    const value = String(payload?.value || '').toLowerCase();
    const mode = this.normalizeMode(payload?.mode || user?.profile?.mode || 'normal');
    const assistantMessage = String(payload?.assistantMessage || '').trim();
    const userMessage = String(payload?.userMessage || '').trim();

    if (!['up', 'down'].includes(value)) {
      throw new Error('Invalid feedback value. Use up or down.');
    }

    if (!assistantMessage) {
      throw new Error('assistantMessage is required for feedback.');
    }

    const shortAssistant = assistantMessage.slice(0, 220);
    const shortUser = userMessage.slice(0, 180);

    if (value === 'up') {
      this.memoryManager.addPinnedMemory(
        user,
        `Preferred answer style from assistant: ${shortAssistant}`,
        40,
        0.92,
        mode,
      );
      this.memoryManager.addNote(
        user,
        `Feedback up: answer quality was good${shortUser ? ` for prompt "${shortUser}"` : ''}.`,
        mode,
      );
    } else {
      this.memoryManager.addNote(
        user,
        `Feedback down: improve clarity/accuracy${shortUser ? ` for prompt "${shortUser}"` : ''}.`,
        mode,
      );
    }

    memory.users[userId] = user;
    this.saveMemory(memory);

    return {
      stored: true,
      value,
      mode,
    };
  }

  isEnabled() {
    return this.llmClient.isEnabled();
  }

  createMemoryStore() {
    return StateStoreFactory.create({
      backend: this.memoryBackend,
      sqliteFilePath: this.runtime.memorySqliteFile,
      defaultKey: this.runtime.memoryKey,
    });
  }

  loadMemory() {
    const raw = this.memoryStore.readState(this.runtime.memoryKey, { users: {} });
    const migrated = this.memorySchemaManager.migrate(raw);
    if (migrated.changed) {
      this.memoryStore.writeState(this.runtime.memoryKey, migrated.memory);
    }
    return migrated.memory;
  }

  saveMemory(memory) {
    const versionedMemory = this.memorySchemaManager.ensureLatest(memory);
    this.memoryStore.writeState(this.runtime.memoryKey, versionedMemory);
  }

  loadModeConfig() {
    return this.modeConfigRepository.load();
  }

  resetUserState(userId = 'default') {
    return this.memoryManager.resetUserState(userId);
  }

  resetAllState(userId = 'default') {
    this.memoryStore.deleteState(this.runtime.memoryKey);
    return this.memoryManager.resetUserState(userId);
  }

  getRuntimeConfig() {
    return {
      ...this.runtime,
    };
  }

  getSettings(userId = 'default') {
    const modeState = this.getMode(userId);
    return {
      mode: modeState.mode,
      character: modeState.character,
      llmEnabled: this.isEnabled(),
      runtime: {
        historyWindow: this.historyWindow,
        historyStoreLimit: this.historyStoreLimit,
        notesLimit: this.notesLimit,
        historyRetentionDays: this.historyRetentionDays,
        summaryChunkSize: this.summaryChunkSize,
        summaryLimit: this.summaryLimit,
        summaryContextWindow: this.summaryContextWindow,
        maxMessageChars: this.maxMessageChars,
        memoryQualityThreshold: this.memoryQualityThreshold,
        memoryDecayDays: this.memoryDecayDays,
        memoryForgetThreshold: this.memoryForgetThreshold,
      },
      memoryOverview: this.memoryManager.getMemoryOverview(userId),
    };
  }

  updateSettings(userId = 'default', updates = {}) {
    const toNumber = (value, fallback) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : fallback;
    };

    const runtimeSettingSpecs = [
      {
        key: 'historyWindow',
        min: 1,
      },
      {
        key: 'historyStoreLimit',
        min: 1,
        onUpdate: (nextValue) => {
          this.memoryManager.historyStoreLimit = nextValue;
        },
      },
      {
        key: 'notesLimit',
        min: 1,
        onUpdate: (nextValue) => {
          this.memoryManager.notesLimit = nextValue;
        },
      },
      {
        key: 'historyRetentionDays',
        min: 1,
        onUpdate: (nextValue) => {
          this.memoryManager.historyRetentionDays = nextValue;
        },
      },
      {
        key: 'summaryChunkSize',
        min: 1,
        onUpdate: (nextValue) => {
          this.memoryManager.summaryChunkSize = nextValue;
        },
      },
      {
        key: 'summaryLimit',
        min: 1,
        onUpdate: (nextValue) => {
          this.memoryManager.summaryLimit = nextValue;
        },
      },
      {
        key: 'summaryContextWindow',
        min: 1,
        onUpdate: (nextValue) => {
          this.promptBuilder.summaryContextWindow = nextValue;
        },
      },
      {
        key: 'maxMessageChars',
        min: 50,
      },
      {
        key: 'memoryQualityThreshold',
        min: 0,
        max: 1,
        onUpdate: (nextValue) => {
          this.memoryManager.memoryQualityThreshold = nextValue;
        },
      },
      {
        key: 'memoryDecayDays',
        min: 1,
        onUpdate: (nextValue) => {
          this.memoryManager.memoryDecayDays = nextValue;
        },
      },
      {
        key: 'memoryForgetThreshold',
        min: 0,
        max: 1,
        onUpdate: (nextValue) => {
          this.memoryManager.memoryForgetThreshold = nextValue;
        },
      },
    ];

    runtimeSettingSpecs.forEach((spec) => {
      if (updates[spec.key] == null) return;

      const currentValue = this[spec.key];
      const numericValue = toNumber(updates[spec.key], currentValue);
      const boundedMin = Math.max(spec.min, numericValue);
      const boundedValue = Number.isFinite(spec.max)
        ? Math.min(spec.max, boundedMin)
        : boundedMin;

      this[spec.key] = boundedValue;
      if (typeof spec.onUpdate === 'function') {
        spec.onUpdate(boundedValue);
      }
    });

    return this.getSettings(userId);
  }

  pruneMemoryByDays(userId = 'default', days = 7, mode = 'all') {
    return this.memoryManager.pruneHistoryByDays(userId, days, mode);
  }

  deleteMemoryByDate(userId = 'default', day = '', mode = 'all') {
    return this.memoryManager.deleteByDate(userId, day, mode);
  }

  deleteRecentMemoryDays(userId = 'default', days = 7, mode = 'all') {
    return this.memoryManager.deleteRecentDays(userId, days, mode);
  }

  deleteMemoryByTag(userId = 'default', tag = '', mode = 'all') {
    return this.memoryManager.deleteByTag(userId, tag, mode);
  }

  deleteSingleMemoryItem(userId = 'default', payload = {}) {
    return this.memoryManager.deleteMemoryItem(userId, payload);
  }

  setPreferredName(userId = 'default', preferredName = '') {
    return this.memoryManager.setPreferredName(userId, preferredName);
  }

  setMode(userId = 'default', mode = 'normal') {
    const { memory, user, modeConfig } = this.memoryManager.getUserState(userId);
    user.profile.characterId = this.normalizeCharacterId(user.profile.characterId, modeConfig);
    user.profile.mode = this.normalizeMode(mode);
    this.memoryManager.syncLegacyProfileFromMode(user, user.profile.mode);
    memory.users[userId] = user;
    this.saveMemory(memory);
    return {
      mode: user.profile.mode,
      ...this.getModeConfig(user.profile.mode, modeConfig, user.profile.characterId),
      profile: user.profile,
    };
  }

  setCharacter(userId = 'default', characterId = 'luna') {
    const { memory, user, modeConfig } = this.memoryManager.getUserState(userId);
    user.profile.characterId = this.normalizeCharacterId(characterId, modeConfig);
    memory.users[userId] = user;
    this.saveMemory(memory);
    return {
      ...this.getModeConfig(user.profile.mode, modeConfig, user.profile.characterId),
      mode: this.normalizeMode(user.profile.mode),
      profile: user.profile,
    };
  }

  setModeExtras(userId = 'default', { instructions, memories } = {}) {
    return this.memoryManager.setModeExtras(userId, { instructions, memories });
  }

  addTrainingExample(userId = 'default', payload = {}) {
    return this.memoryManager.addTrainingExample(userId, payload);
  }

  getMode(userId = 'default') {
    const { user, modeConfig } = this.memoryManager.getUserState(userId);
    const mode = this.normalizeMode(user.profile.mode);
    user.profile.characterId = this.normalizeCharacterId(user.profile.characterId, modeConfig);
    return {
      mode,
      ...this.getModeConfig(mode, modeConfig, user.profile.characterId),
      profile: user.profile,
    };
  }

  buildSystemPrompt(user, mode = 'normal') {
    return this.promptBuilder.buildSystemPrompt(user, mode);
  }

  isTradingCharacter(modeConfig = {}) {
    const domain = String(modeConfig?.characterDefinition?.definition?.domain || '').toLowerCase();
    if (domain) return domain === 'trading' || domain === 'trade';

    const mission = String(modeConfig?.characterDefinition?.definition?.modeProfiles?.normal?.mission || '').toLowerCase();
    return /(trade|trading|alpaca|broker|portfolio)/.test(mission);
  }

  fallbackReply(message, snapshot, user, mode = 'normal') {
    const activeMode = this.normalizeMode(mode || user?.profile?.mode);
    const modeConfig = this.getModeConfig(activeMode, null, user?.profile?.characterId);
    const tradingCharacter = this.isTradingCharacter(modeConfig);
    const name = user.profile.preferredName || 'du';
    const text = (message || '').toLowerCase();
    const contextShiftToTask = this.isRoleplayToTaskContextShift(message, activeMode);
    const equity = snapshot?.account?.equity || 'n/a';
    const cash = snapshot?.account?.cash || 'n/a';
    const openOrders = typeof snapshot?.orders?.open === 'number' ? snapshot.orders.open : 'n/a';

    if (contextShiftToTask) {
      if (tradingCharacter) {
        return `${modeConfig.character}: Verstanden — wir sind wieder im normalen Sachkontext. Nenne Ziel, Risiko und Zeithorizont, dann gebe ich klare nächste Schritte.`;
      }
      return `${modeConfig.character}: Verstanden — wir sind wieder im normalen Sachkontext. Nenne dein Tagesziel oder den nächsten Termin, dann strukturiere ich es klar für dich.`;
    }

    if (text.includes('status') || text.includes('update')) {
      if (tradingCharacter) {
        if (activeMode === 'uncensored') {
          return `${modeConfig.character}: Equity ${equity}, Cash ${cash}, offene Orders ${openOrders}. Fokus: Risiko klein halten.`;
        }
        return `Hey ${name} ✨ Equity ${equity}, Cash ${cash}, offene Orders ${openOrders}.`;
      }
      return `${modeConfig.character}: Ich bin da. Sag mir kurz deinen Fokus (Termine, To-dos oder Gespräch), dann setze ich dir einen klaren Plan auf.`;
    }

    if (activeMode === 'uncensored') {
      if (tradingCharacter) {
        return `${modeConfig.character}: Ready. Frag nach Status, Tagesplan oder Risiko-Setup.`;
      }
      return `${modeConfig.character}: Ready. Sag mir, was ich für dich organisieren oder formulieren soll.`;
    }

    if (tradingCharacter) {
      return `Hey ${name} 💫 ich bin ready! Frag mich nach Status, Tagesplan oder Risiko-Setup.`;
    }
    return `Hey ${name} 💫 ich bin ready! Frag mich nach Terminen, Tagesplan, Nachrichten oder Entscheidungen.`;
  }

  isRoleplayToTaskContextShift(message = '', activeMode = 'normal') {
    if (this.normalizeMode(activeMode) !== 'uncensored') return false;

    const text = String(message || '').toLowerCase();
    if (!text.trim()) return false;

    const taskSignals = [
      'trading', 'trade', 'order', 'orders', 'position', 'positions', 'risk', 'risiko',
      'drawdown', 'entry', 'exit', 'stop', 'take profit', 'konto', 'account',
      'status', 'api', 'strategie', 'setup', 'chart', 'markt', 'market',
      'portfolio', 'balance', 'equity', 'cash', 'analyse', 'analysis',
      'hilfe', 'help', 'warum', 'wie', 'bitte',
      'termin', 'kalender', 'to-do', 'todo', 'aufgabe', 'plan', 'tagesplan',
      'erinner', 'nachricht', 'antwort', 'mail', 'whatsapp', 'priorität',
    ];

    const roleplaySignals = [
      'rollenspiel', 'roleplay', 'naughty', 'horny', 'sex', 'sexy', 'kuss', 'küss',
      'nackt', 'brust', 'dominant', 'flirt', '*',
    ];

    const hasTaskSignal = taskSignals.some((token) => text.includes(token));
    const hasRoleplaySignal = roleplaySignals.some((token) => text.includes(token));
    const explicitRoleplayExit = /(kein|nicht mehr|stop|ohne)\s+(rollenspiel|roleplay|flirt|sexy|sex|naughty)/i.test(text)
      || /(rollenspiel|roleplay|flirt|sexy|sex|naughty)\s+(aus|beenden|stop)/i.test(text);

    if (explicitRoleplayExit) return true;
    return hasTaskSignal && !hasRoleplaySignal;
  }

  normalizeForRepeatCheck(text = '') {
    return String(text || '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .trim();
  }

  isRepetitiveReply(reply = '', recentAssistantReplies = []) {
    const current = this.normalizeForRepeatCheck(reply);
    if (!current || current.length < 12) return false;

    const recent = (Array.isArray(recentAssistantReplies) ? recentAssistantReplies : [])
      .map((item) => this.normalizeForRepeatCheck(item))
      .filter(Boolean);

    if (!recent.length) return false;
    if (recent.includes(current)) return true;

    const currentHead = current.slice(0, 120);
    return recent.some((old) => old.slice(0, 120) === currentHead);
  }

  async chat({ message, snapshot, userId = 'default', mode = 'normal' }) {
    const { memory, user, modeConfig } = this.memoryManager.getUserState(userId);
    const activeMode = this.normalizeMode(mode || user?.profile?.mode);
    const contextShiftToTask = this.isRoleplayToTaskContextShift(message, activeMode);
    const transientSystemInstruction = contextShiftToTask
      ? 'Kontextwechsel erkannt: Der User spricht nicht mehr im Rollenspiel. Verlasse RP-/Flirt-Stil sofort und antworte ab jetzt sachlich, präzise und aufgabenorientiert auf die aktuelle Anfrage.'
      : '';
    const modeUsesChatMemory = activeMode === 'uncensored';
    user.profile.mode = activeMode;
    this.memoryManager.updateProfileFromMessage(user, message, modeConfig);

    this.memoryManager.applyRetentionAndCompaction(user, 'history', 'summaries');
    this.memoryManager.applyRetentionAndCompaction(user, 'uncensoredHistory', 'uncensoredSummaries');

    const recentHistory = modeUsesChatMemory
      ? [...(user.history || []), ...(user.uncensoredHistory || [])]
        .sort((a, b) => Date.parse(a?.at || 0) - Date.parse(b?.at || 0))
        .slice(-this.historyWindow)
        .flatMap((h) => ([
          { role: 'user', content: h.user },
          { role: 'assistant', content: h.assistant },
        ]))
      : (user.history || [])
        .slice(-this.historyWindow)
        .flatMap((h) => ([
          { role: 'user', content: h.user },
          { role: 'assistant', content: h.assistant },
        ]));

    const recentAssistantReplies = modeUsesChatMemory
      ? [...(user.history || []), ...(user.uncensoredHistory || [])]
        .sort((a, b) => Date.parse(a?.at || 0) - Date.parse(b?.at || 0))
        .slice(-4)
        .map((h) => String(h?.assistant || '').trim())
        .filter(Boolean)
      : (user.history || [])
        .slice(-4)
        .map((h) => String(h?.assistant || '').trim())
        .filter(Boolean);

    let llmResult = this.isEnabled()
      ? await this.callLLM(user, message, snapshot, recentHistory, activeMode, transientSystemInstruction)
      : {
        reply: this.fallbackReply(message, snapshot, user, activeMode),
        meta: { webSearchUsed: false },
      };
    let responseText = String(llmResult?.reply || '').trim() || 'Ich habe gerade keine Antwort generieren können.';

    if (this.isEnabled() && this.isRepetitiveReply(responseText, recentAssistantReplies)) {
      try {
        const retryMessage = `${String(message || '').trim()}\n\n[Interner Qualitäts-Hinweis: Antworte diesmal klar anders formuliert, ohne Wiederholung von Einleitung oder Satzmuster.]`;
        const retryResult = await this.callLLM(user, retryMessage, snapshot, recentHistory, activeMode, transientSystemInstruction);
        const retryText = String(retryResult?.reply || '').trim();
        if (retryText && !this.isRepetitiveReply(retryText, recentAssistantReplies)) {
          llmResult = retryResult;
          responseText = retryText;
        }
      } catch {
        // keep first response if retry fails
      }
    }

    responseText = responseText.slice(0, this.maxMessageChars).trim();

    if (modeUsesChatMemory) {
      user.uncensoredHistory = [...(user.uncensoredHistory || []), {
        at: new Date().toISOString(),
        user: (message || '').slice(0, this.maxMessageChars),
        assistant: (responseText || '').slice(0, this.maxMessageChars),
      }];
      this.memoryManager.applyRetentionAndCompaction(user, 'uncensoredHistory', 'uncensoredSummaries');
    } else {
      user.history = [...(user.history || []), {
        at: new Date().toISOString(),
        user: (message || '').slice(0, this.maxMessageChars),
        assistant: (responseText || '').slice(0, this.maxMessageChars),
      }];
      this.memoryManager.applyRetentionAndCompaction(user, 'history', 'summaries');
    }

    memory.users[userId] = user;
    this.saveMemory(memory);

    return {
      reply: responseText,
      meta: {
        webSearchUsed: !!llmResult?.meta?.webSearchUsed,
      },
      profile: user.profile,
      llmEnabled: this.isEnabled(),
      mode: activeMode,
      ...this.getModeConfig(activeMode, modeConfig, user.profile.characterId),
    };
  }

  async callLLM(user, message, snapshot, recentHistory, mode = 'normal', transientSystemInstruction = '') {
    return this.llmClient.chat(user, message, snapshot, recentHistory, mode, transientSystemInstruction);
  }

  async callOllama(user, message, snapshot, recentHistory, mode = 'normal', transientSystemInstruction = '') {
    return this.llmClient.callOllama(user, message, snapshot, recentHistory, mode, transientSystemInstruction);
  }

  async callOpenAICompatible(user, message, snapshot, recentHistory, mode = 'normal', transientSystemInstruction = '') {
    return this.llmClient.callOpenAICompatible(user, message, snapshot, recentHistory, mode, transientSystemInstruction);
  }
}

export default new CompanionLLMService();
