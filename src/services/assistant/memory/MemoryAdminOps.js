export function getMemoryOverview(manager, userId = 'default') {
  const { user } = manager.getUserState(userId);
  const normal = user?.profile?.modeMemory?.normal || manager.buildModeMemoryDefaults(true);
  const uncensored = user?.profile?.modeMemory?.uncensored || manager.buildModeMemoryDefaults(false);

  const makeModeStats = (bucket = {}) => ({
    goals: Array.isArray(bucket.goals) ? bucket.goals.length : 0,
    notes: Array.isArray(bucket.notes) ? bucket.notes.length : 0,
    pinnedMemories: Array.isArray(bucket.pinnedMemories) ? bucket.pinnedMemories.length : 0,
  });

  return {
    mode: user?.profile?.mode || 'normal',
    style: user?.profile?.style || 'playful-supportive',
    preferredName: user?.profile?.preferredName || '',
    history: {
      normal: Array.isArray(user?.history) ? user.history.length : 0,
      uncensored: Array.isArray(user?.uncensoredHistory) ? user.uncensoredHistory.length : 0,
    },
    summaries: {
      normal: Array.isArray(user?.summaries) ? user.summaries.length : 0,
      uncensored: Array.isArray(user?.uncensoredSummaries) ? user.uncensoredSummaries.length : 0,
    },
    memories: {
      normal: makeModeStats(normal),
      uncensored: makeModeStats(uncensored),
    },
  };
}

export function pruneHistoryByDays(manager, userId = 'default', days = 7, mode = 'all') {
  const safeDays = Math.max(1, Number(days) || 7);
  const cutoffTs = Date.now() - safeDays * 24 * 60 * 60 * 1000;
  const normalizedMode = String(mode || 'all').toLowerCase();

  const { memory, user } = manager.getUserState(userId);

  const pruneHistoryList = (list = []) => list.filter((turn) => {
    const at = Date.parse(turn?.at || '');
    if (Number.isNaN(at)) return true;
    return at >= cutoffTs;
  });

  const pruneSummaryList = (list = []) => list.filter((entry) => {
    const at = Date.parse(entry?.at || '');
    if (Number.isNaN(at)) return true;
    return at >= cutoffTs;
  });

  if (normalizedMode === 'all' || normalizedMode === 'normal') {
    user.history = pruneHistoryList(user.history || []);
    user.summaries = pruneSummaryList(user.summaries || []);
  }
  if (normalizedMode === 'all' || normalizedMode === 'uncensored') {
    user.uncensoredHistory = pruneHistoryList(user.uncensoredHistory || []);
    user.uncensoredSummaries = pruneSummaryList(user.uncensoredSummaries || []);
  }

  memory.users[userId] = user;
  manager.saveMemory(memory);

  return getMemoryOverview(manager, userId);
}

export function deleteByDate(manager, userId = 'default', day = '', mode = 'all') {
  const dayText = String(day || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayText)) {
    return getMemoryOverview(manager, userId);
  }

  const normalizedMode = String(mode || 'all').toLowerCase();
  const { memory, user } = manager.getUserState(userId);

  const toLocalDayKey = (isoDate) => {
    const ts = Date.parse(isoDate || '');
    if (Number.isNaN(ts)) return '';
    const d = new Date(ts);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dayNum = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dayNum}`;
  };

  const isOnDay = (isoDate) => {
    const dayKey = toLocalDayKey(isoDate);
    return dayKey === dayText;
  };

  const filterHistoryByDate = (list = []) => list.filter((turn) => !isOnDay(turn?.at));
  const filterSummariesByDate = (list = []) => list.filter((entry) => !isOnDay(entry?.at));

  if (normalizedMode === 'all' || normalizedMode === 'normal') {
    user.history = filterHistoryByDate(user.history || []);
    user.summaries = filterSummariesByDate(user.summaries || []);
  }
  if (normalizedMode === 'all' || normalizedMode === 'uncensored') {
    user.uncensoredHistory = filterHistoryByDate(user.uncensoredHistory || []);
    user.uncensoredSummaries = filterSummariesByDate(user.uncensoredSummaries || []);
  }

  manager.ensureModeMemory(user);
  const targetModes = normalizedMode === 'all' ? ['normal', 'uncensored'] : [manager.normalizeMode(normalizedMode)];
  for (const modeName of targetModes) {
    const bucket = user.profile.modeMemory[modeName] || manager.buildModeMemoryDefaults(modeName === 'normal');
    const goalsMeta = bucket?.memoryMeta?.goals || {};
    const pinnedMeta = bucket?.memoryMeta?.pinnedMemories || {};

    bucket.goals = (bucket.goals || []).filter((value) => {
      const updatedAt = goalsMeta?.[value]?.updatedAt;
      return !isOnDay(updatedAt);
    });
    bucket.pinnedMemories = (bucket.pinnedMemories || []).filter((value) => {
      const updatedAt = pinnedMeta?.[value]?.updatedAt;
      return !isOnDay(updatedAt);
    });

    Object.keys(goalsMeta).forEach((key) => {
      if (isOnDay(goalsMeta?.[key]?.updatedAt)) {
        delete goalsMeta[key];
      }
    });
    Object.keys(pinnedMeta).forEach((key) => {
      if (isOnDay(pinnedMeta?.[key]?.updatedAt)) {
        delete pinnedMeta[key];
      }
    });

    bucket.memoryMeta = {
      goals: goalsMeta,
      pinnedMemories: pinnedMeta,
    };
    user.profile.modeMemory[modeName] = bucket;
  }

  manager.syncLegacyProfileFromMode(user, user?.profile?.mode || 'normal');
  memory.users[userId] = user;
  manager.saveMemory(memory);

  return getMemoryOverview(manager, userId);
}

export function deleteRecentDays(manager, userId = 'default', days = 7, mode = 'all') {
  const safeDays = Math.max(1, Number(days) || 7);
  const startTs = Date.now() - safeDays * 24 * 60 * 60 * 1000;
  const normalizedMode = String(mode || 'all').toLowerCase();

  const { memory, user } = manager.getUserState(userId);

  const isRecent = (isoDate) => {
    const ts = Date.parse(isoDate || '');
    if (Number.isNaN(ts)) return false;
    return ts >= startTs;
  };

  const filterHistory = (list = []) => list.filter((turn) => !isRecent(turn?.at));
  const filterSummaries = (list = []) => list.filter((entry) => !isRecent(entry?.at));

  if (normalizedMode === 'all' || normalizedMode === 'normal') {
    user.history = filterHistory(user.history || []);
    user.summaries = filterSummaries(user.summaries || []);
  }
  if (normalizedMode === 'all' || normalizedMode === 'uncensored') {
    user.uncensoredHistory = filterHistory(user.uncensoredHistory || []);
    user.uncensoredSummaries = filterSummaries(user.uncensoredSummaries || []);
  }

  manager.ensureModeMemory(user);
  const targetModes = normalizedMode === 'all' ? ['normal', 'uncensored'] : [manager.normalizeMode(normalizedMode)];
  for (const modeName of targetModes) {
    const bucket = user.profile.modeMemory[modeName] || manager.buildModeMemoryDefaults(modeName === 'normal');
    const goalsMeta = bucket?.memoryMeta?.goals || {};
    const pinnedMeta = bucket?.memoryMeta?.pinnedMemories || {};

    bucket.goals = (bucket.goals || []).filter((value) => !isRecent(goalsMeta?.[value]?.updatedAt));
    bucket.pinnedMemories = (bucket.pinnedMemories || []).filter((value) => !isRecent(pinnedMeta?.[value]?.updatedAt));

    Object.keys(goalsMeta).forEach((key) => {
      if (isRecent(goalsMeta?.[key]?.updatedAt)) {
        delete goalsMeta[key];
      }
    });
    Object.keys(pinnedMeta).forEach((key) => {
      if (isRecent(pinnedMeta?.[key]?.updatedAt)) {
        delete pinnedMeta[key];
      }
    });

    bucket.memoryMeta = {
      goals: goalsMeta,
      pinnedMemories: pinnedMeta,
    };
    user.profile.modeMemory[modeName] = bucket;
  }

  manager.syncLegacyProfileFromMode(user, user?.profile?.mode || 'normal');
  memory.users[userId] = user;
  manager.saveMemory(memory);

  return getMemoryOverview(manager, userId);
}

export function deleteByTag(manager, userId = 'default', tag = '', mode = 'all') {
  const needle = manager.normalizeMemoryText(tag).toLowerCase();
  if (!needle) {
    return getMemoryOverview(manager, userId);
  }

  const normalizedMode = String(mode || 'all').toLowerCase();
  const { memory, user } = manager.getUserState(userId);

  const targetModes = normalizedMode === 'all'
    ? ['normal', 'uncensored']
    : [manager.normalizeMode(normalizedMode)];

  manager.ensureModeMemory(user);

  for (const modeName of targetModes) {
    const bucket = user.profile.modeMemory[modeName] || manager.buildModeMemoryDefaults(modeName === 'normal');
    const filterByTag = (value) => !String(value || '').toLowerCase().includes(needle);

    bucket.goals = (bucket.goals || []).filter(filterByTag);
    bucket.notes = (bucket.notes || []).filter(filterByTag);
    bucket.pinnedMemories = (bucket.pinnedMemories || []).filter(filterByTag);

    const goalsMeta = bucket?.memoryMeta?.goals || {};
    const pinnedMeta = bucket?.memoryMeta?.pinnedMemories || {};

    Object.keys(goalsMeta).forEach((k) => {
      if (k.toLowerCase().includes(needle)) {
        delete goalsMeta[k];
      }
    });
    Object.keys(pinnedMeta).forEach((k) => {
      if (k.toLowerCase().includes(needle)) {
        delete pinnedMeta[k];
      }
    });

    bucket.memoryMeta = {
      goals: goalsMeta,
      pinnedMemories: pinnedMeta,
    };

    user.profile.modeMemory[modeName] = bucket;
  }

  const filterHistory = (list = []) => list.filter((turn) => {
    const userText = String(turn?.user || '').toLowerCase();
    const assistantText = String(turn?.assistant || '').toLowerCase();
    return !userText.includes(needle) && !assistantText.includes(needle);
  });

  const filterSummaries = (list = []) => list.filter((entry) => {
    const reason = String(entry?.reason || '').toLowerCase();
    const summary = String(entry?.summary || '').toLowerCase();
    const tags = Array.isArray(entry?.tags) ? entry.tags.map((v) => String(v || '').toLowerCase()) : [];
    return !reason.includes(needle) && !summary.includes(needle) && !tags.some((t) => t.includes(needle));
  });

  if (normalizedMode === 'all' || normalizedMode === 'normal') {
    user.history = filterHistory(user.history || []);
    user.summaries = filterSummaries(user.summaries || []);
  }
  if (normalizedMode === 'all' || normalizedMode === 'uncensored') {
    user.uncensoredHistory = filterHistory(user.uncensoredHistory || []);
    user.uncensoredSummaries = filterSummaries(user.uncensoredSummaries || []);
  }

  manager.syncLegacyProfileFromMode(user, user?.profile?.mode || 'normal');

  memory.users[userId] = user;
  manager.saveMemory(memory);

  return getMemoryOverview(manager, userId);
}

export function deleteMemoryItem(manager, userId = 'default', { mode = 'normal', memoryType = 'note', text = '' } = {}) {
  const normalizedText = manager.normalizeMemoryText(text);
  if (!normalizedText) {
    return getMemoryOverview(manager, userId);
  }

  const normalizedMode = manager.normalizeMode(mode);
  const type = String(memoryType || 'note').toLowerCase();
  const { memory, user } = manager.getUserState(userId);
  manager.ensureModeMemory(user);

  const bucket = user.profile.modeMemory[normalizedMode] || manager.buildModeMemoryDefaults(normalizedMode === 'normal');

  if (type === 'goal') {
    bucket.goals = (bucket.goals || []).filter((v) => v !== normalizedText);
    if (bucket?.memoryMeta?.goals && bucket.memoryMeta.goals[normalizedText]) {
      delete bucket.memoryMeta.goals[normalizedText];
    }
  } else if (type === 'pinned' || type === 'pinnedmemory' || type === 'pinned_memories') {
    bucket.pinnedMemories = (bucket.pinnedMemories || []).filter((v) => v !== normalizedText);
    if (bucket?.memoryMeta?.pinnedMemories && bucket.memoryMeta.pinnedMemories[normalizedText]) {
      delete bucket.memoryMeta.pinnedMemories[normalizedText];
    }
  } else {
    bucket.notes = (bucket.notes || []).filter((v) => v !== normalizedText);
  }

  user.profile.modeMemory[normalizedMode] = bucket;
  manager.syncLegacyProfileFromMode(user, user?.profile?.mode || 'normal');

  memory.users[userId] = user;
  manager.saveMemory(memory);

  return getMemoryOverview(manager, userId);
}
