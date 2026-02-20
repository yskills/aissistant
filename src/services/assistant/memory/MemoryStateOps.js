function sanitizeVoiceSettings(input = {}) {
  const source = (input && typeof input === 'object') ? input : {};
  const toNumber = (value, fallback) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  const preset = String(source.preset || 'egirl-cute').trim().toLowerCase() || 'egirl-cute';
  const voiceName = String(source.voiceName || '').trim();
  const lang = String(source.lang || 'de-DE').trim() || 'de-DE';
  const rate = Math.min(1.5, Math.max(0.6, toNumber(source.rate, 1.0)));
  const pitch = Math.min(2.0, Math.max(0.6, toNumber(source.pitch, 1.15)));
  const volume = Math.min(1.0, Math.max(0.1, toNumber(source.volume, 1.0)));
  const autoSpeak = source.autoSpeak === true;

  return {
    preset,
    voiceName,
    lang,
    rate,
    pitch,
    volume,
    autoSpeak,
  };
}

export function defaultUserState(manager) {
  return {
    profile: {
      mode: 'normal',
      preferredName: '',
      style: 'playful-supportive',
      goals: ['daily structure and focus'],
      notes: [],
      pinnedMemories: [],
      memoryMeta: { goals: {}, pinnedMemories: {} },
      modeMemory: {
        normal: manager.buildModeMemoryDefaults(true),
        uncensored: manager.buildModeMemoryDefaults(false),
      },
      modeExtras: {
        uncensoredInstructions: [],
        uncensoredMemories: [],
        trainingExamples: [],
        voiceSettings: sanitizeVoiceSettings(),
      },
    },
    history: [],
    summaries: [],
    uncensoredHistory: [],
    uncensoredSummaries: [],
  };
}

export function normalizeUserState(manager, user) {
  const base = defaultUserState(manager);
  const normalized = {
    ...base,
    ...(user || {}),
    profile: {
      ...base.profile,
      ...(user?.profile || {}),
      mode: manager.normalizeMode(user?.profile?.mode || base.profile.mode),
      goals: Array.isArray(user?.profile?.goals) ? user.profile.goals : base.profile.goals,
      notes: Array.isArray(user?.profile?.notes) ? user.profile.notes : [],
      pinnedMemories: Array.isArray(user?.profile?.pinnedMemories)
        ? user.profile.pinnedMemories.filter((v) => typeof v === 'string').slice(-40)
        : [],
      memoryMeta: (user?.profile?.memoryMeta && typeof user.profile.memoryMeta === 'object')
        ? user.profile.memoryMeta
        : { goals: {}, pinnedMemories: {} },
      modeMemory: (user?.profile?.modeMemory && typeof user.profile.modeMemory === 'object')
        ? user.profile.modeMemory
        : {
          normal: manager.buildModeMemoryDefaults(true),
          uncensored: manager.buildModeMemoryDefaults(false),
        },
      modeExtras: {
        uncensoredInstructions: Array.isArray(user?.profile?.modeExtras?.uncensoredInstructions)
          ? user.profile.modeExtras.uncensoredInstructions.filter((v) => typeof v === 'string').slice(-20)
          : [],
        uncensoredMemories: Array.isArray(user?.profile?.modeExtras?.uncensoredMemories)
          ? user.profile.modeExtras.uncensoredMemories.filter((v) => typeof v === 'string').slice(-40)
          : [],
        trainingExamples: Array.isArray(user?.profile?.modeExtras?.trainingExamples)
          ? user.profile.modeExtras.trainingExamples
            .filter((item) => item && typeof item === 'object')
            .map((item) => ({
              at: String(item.at || new Date().toISOString()),
              mode: String(item.mode || 'normal').toLowerCase() === 'uncensored' ? 'uncensored' : 'normal',
              source: String(item.source || 'manual'),
              accepted: item.accepted !== false,
              user: String(item.user || '').trim().slice(0, 1000),
              assistant: String(item.assistant || '').trim().slice(0, 3500),
              userOriginal: String(item.userOriginal || '').trim().slice(0, 1000),
              assistantOriginal: String(item.assistantOriginal || '').trim().slice(0, 3500),
            }))
            .filter((item) => item.user && item.assistant)
            .slice(-300)
          : [],
        voiceSettings: sanitizeVoiceSettings(user?.profile?.modeExtras?.voiceSettings),
      },
    },
    history: Array.isArray(user?.history) ? user.history : [],
    summaries: Array.isArray(user?.summaries) ? user.summaries : [],
    uncensoredHistory: Array.isArray(user?.uncensoredHistory) ? user.uncensoredHistory : [],
    uncensoredSummaries: Array.isArray(user?.uncensoredSummaries) ? user.uncensoredSummaries : [],
  };

  normalized.profile.notes = normalized.profile.notes.slice(-manager.notesLimit);
  normalized.history = normalized.history.filter((h) => h?.user || h?.assistant);
  normalized.summaries = normalized.summaries.slice(-manager.summaryLimit);
  normalized.uncensoredHistory = normalized.uncensoredHistory.filter((h) => h?.user || h?.assistant);
  normalized.uncensoredSummaries = normalized.uncensoredSummaries.slice(-manager.summaryLimit);

  manager.ensureModeMemory(normalized);

  const legacyGoals = Array.isArray(normalized.profile.goals) ? normalized.profile.goals : [];
  const legacyNotes = Array.isArray(normalized.profile.notes) ? normalized.profile.notes : [];
  const legacyPinned = Array.isArray(normalized.profile.pinnedMemories) ? normalized.profile.pinnedMemories : [];
  const legacyMeta = normalized.profile.memoryMeta || { goals: {}, pinnedMemories: {} };

  if (legacyGoals.length > 0 && normalized.profile.modeMemory.normal.goals.length === 0) {
    normalized.profile.modeMemory.normal.goals = legacyGoals.slice(-8);
  }
  if (legacyNotes.length > 0 && normalized.profile.modeMemory.normal.notes.length === 0) {
    normalized.profile.modeMemory.normal.notes = legacyNotes.slice(-manager.notesLimit);
  }
  if (legacyPinned.length > 0 && normalized.profile.modeMemory.normal.pinnedMemories.length === 0) {
    normalized.profile.modeMemory.normal.pinnedMemories = legacyPinned.slice(-40);
  }
  if (Object.keys(legacyMeta.goals || {}).length > 0 && Object.keys(normalized.profile.modeMemory.normal.memoryMeta.goals || {}).length === 0) {
    normalized.profile.modeMemory.normal.memoryMeta.goals = { ...(legacyMeta.goals || {}) };
  }
  if (Object.keys(legacyMeta.pinnedMemories || {}).length > 0 && Object.keys(normalized.profile.modeMemory.normal.memoryMeta.pinnedMemories || {}).length === 0) {
    normalized.profile.modeMemory.normal.memoryMeta.pinnedMemories = { ...(legacyMeta.pinnedMemories || {}) };
  }

  manager.syncLegacyProfileFromMode(normalized, normalized.profile.mode);
  return normalized;
}

export function getUserState(manager, userId = 'default') {
  const memory = manager.loadMemory();
  const users = memory.users || {};
  const modeConfig = manager.loadModeConfig();
  const fixedPreferredName = (modeConfig?.userProfile?.fixedPreferredName || '').trim();
  const configPinnedMemories = modeConfig?.memoryProfile?.pinnedMemories || [];
  const maxPinnedMemories = Number(modeConfig?.memoryProfile?.maxPinnedMemories || 40);

  if (!users[userId]) {
    users[userId] = defaultUserState(manager);
  } else {
    users[userId] = normalizeUserState(manager, users[userId]);
  }

  manager.applyMemoryDecayAndForgetting(users[userId]);
  const activeMode = manager.normalizeMode(users[userId]?.profile?.mode || 'normal');
  const { bucket } = manager.getActiveModeMemory(users[userId], activeMode);

  if (fixedPreferredName) {
    users[userId].profile.preferredName = fixedPreferredName;
  }
  if (!Array.isArray(bucket.pinnedMemories)) {
    bucket.pinnedMemories = [];
  }
  bucket.pinnedMemories = [...bucket.pinnedMemories, ...configPinnedMemories]
    .filter((v, idx, arr) => arr.indexOf(v) === idx)
    .slice(-maxPinnedMemories);

  manager.syncLegacyProfileFromMode(users[userId], activeMode);

  memory.users = users;
  manager.saveMemory(memory);
  return { memory, user: users[userId], modeConfig };
}

export function resetUserState(manager, userId = 'default') {
  const memory = manager.loadMemory();
  memory.users = memory.users || {};

  memory.users[userId] = defaultUserState(manager);

  manager.saveMemory(memory);
  return memory.users[userId];
}

export function setPreferredName(manager, userId = 'default', preferredName = '') {
  const { memory, user, modeConfig } = getUserState(manager, userId);
  const fixedPreferredName = (modeConfig?.userProfile?.fixedPreferredName || '').trim();
  user.profile.preferredName = fixedPreferredName || (preferredName || '').trim();
  memory.users[userId] = user;
  manager.saveMemory(memory);
  return user;
}

export function setModeExtras(manager, userId = 'default', { instructions, memories } = {}) {
  const { memory, user } = getUserState(manager, userId);
  const cleanedInstructions = Array.isArray(instructions)
    ? instructions.filter((v) => typeof v === 'string').map((v) => v.trim()).filter(Boolean).slice(-20)
    : user.profile?.modeExtras?.uncensoredInstructions || [];

  const cleanedMemories = Array.isArray(memories)
    ? memories.filter((v) => typeof v === 'string').map((v) => v.trim()).filter(Boolean).slice(-40)
    : user.profile?.modeExtras?.uncensoredMemories || [];

  user.profile.modeExtras = {
    uncensoredInstructions: cleanedInstructions,
    uncensoredMemories: cleanedMemories,
    trainingExamples: Array.isArray(user.profile?.modeExtras?.trainingExamples)
      ? user.profile.modeExtras.trainingExamples.slice(-300)
      : [],
    voiceSettings: sanitizeVoiceSettings(user.profile?.modeExtras?.voiceSettings),
  };

  memory.users[userId] = user;
  manager.saveMemory(memory);

  return {
    profile: user.profile,
    modeExtras: user.profile.modeExtras,
  };
}
