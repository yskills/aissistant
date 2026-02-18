import {
  defaultUserState as defaultUserStateOp,
  normalizeUserState as normalizeUserStateOp,
  getUserState as getUserStateOp,
  resetUserState as resetUserStateOp,
  setPreferredName as setPreferredNameOp,
  setModeExtras as setModeExtrasOp,
} from './memory/MemoryStateOps.js';
import {
  getMemoryOverview as getMemoryOverviewOp,
  pruneHistoryByDays as pruneHistoryByDaysOp,
  deleteByDate as deleteByDateOp,
  deleteRecentDays as deleteRecentDaysOp,
  deleteByTag as deleteByTagOp,
  deleteMemoryItem as deleteMemoryItemOp,
} from './memory/MemoryAdminOps.js';

class MemoryManager {
  constructor({
    loadMemory,
    saveMemory,
    loadModeConfig,
    normalizeMode,
    notesLimit = 10,
    historyStoreLimit = 40,
    historyRetentionDays = 45,
    summaryChunkSize = 20,
    summaryLimit = 24,
    memoryQualityThreshold = 0.55,
    memoryMinLength = 10,
    memoryMaxLength = 180,
    memoryDecayDays = 30,
    memoryForgetThreshold = 0.35,
  } = {}) {
    this.loadMemory = loadMemory;
    this.saveMemory = saveMemory;
    this.loadModeConfig = loadModeConfig;
    this.normalizeMode = normalizeMode;

    this.notesLimit = notesLimit;
    this.historyStoreLimit = historyStoreLimit;
    this.historyRetentionDays = historyRetentionDays;
    this.summaryChunkSize = summaryChunkSize;
    this.summaryLimit = summaryLimit;

    this.memoryQualityThreshold = memoryQualityThreshold;
    this.memoryMinLength = memoryMinLength;
    this.memoryMaxLength = memoryMaxLength;
    this.memoryDecayDays = memoryDecayDays;
    this.memoryForgetThreshold = memoryForgetThreshold;
  }

  normalizeMemoryText(text = '') {
    return String(text || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, this.memoryMaxLength);
  }

  scoreMemoryQuality(text = '') {
    const value = this.normalizeMemoryText(text);
    if (!value) return 0;

    let score = 0.35;
    const len = value.length;

    if (len >= this.memoryMinLength && len <= this.memoryMaxLength) score += 0.2;
    if (/\b(risk|risiko|drawdown|goal|ziel|style|preferred|name|paper|trade|trading|mode|always|never|important|wichtig)\b/i.test(value)) score += 0.2;
    if (/\d/.test(value)) score += 0.05;
    if (/[.!?]/.test(value)) score += 0.03;

    if (/^(ok|okay|lol|haha|hmm|hi|hey|yo|nice|cool|klar|passt|jo)$/i.test(value)) score -= 0.45;
    if (/(.)\1{4,}/.test(value)) score -= 0.2;
    if (/\b(idk|whatever|egal)\b/i.test(value)) score -= 0.2;

    return Math.max(0, Math.min(1, score));
  }

  shouldStoreMemory(text = '', minScore = this.memoryQualityThreshold) {
    const score = this.scoreMemoryQuality(text);
    return { accept: score >= minScore, score };
  }

  buildModeMemoryDefaults(includeSeedGoal = false) {
    return {
      goals: includeSeedGoal ? ['daily structure and focus'] : [],
      notes: [],
      pinnedMemories: [],
      memoryMeta: {
        goals: {},
        pinnedMemories: {},
      },
    };
  }

  ensureModeMemory(user) {
    if (!user.profile.modeMemory || typeof user.profile.modeMemory !== 'object') {
      user.profile.modeMemory = {
        normal: this.buildModeMemoryDefaults(true),
        uncensored: this.buildModeMemoryDefaults(false),
      };
    }

    const ensureSingleMode = (modeName, includeSeedGoal = false) => {
      const defaults = this.buildModeMemoryDefaults(includeSeedGoal);
      const existing = user.profile.modeMemory?.[modeName] || {};
      const merged = {
        ...defaults,
        ...(existing || {}),
      };

      merged.goals = Array.isArray(merged.goals)
        ? merged.goals.filter((v) => typeof v === 'string').map((v) => v.trim()).filter(Boolean).slice(-8)
        : defaults.goals;
      merged.notes = Array.isArray(merged.notes)
        ? merged.notes.filter((v) => typeof v === 'string').map((v) => v.trim()).filter(Boolean).slice(-this.notesLimit)
        : [];
      merged.pinnedMemories = Array.isArray(merged.pinnedMemories)
        ? merged.pinnedMemories.filter((v) => typeof v === 'string').map((v) => v.trim()).filter(Boolean).slice(-40)
        : [];
      merged.memoryMeta = {
        goals: (merged?.memoryMeta?.goals && typeof merged.memoryMeta.goals === 'object') ? merged.memoryMeta.goals : {},
        pinnedMemories: (merged?.memoryMeta?.pinnedMemories && typeof merged.memoryMeta.pinnedMemories === 'object') ? merged.memoryMeta.pinnedMemories : {},
      };

      user.profile.modeMemory[modeName] = merged;
    };

    ensureSingleMode('normal', true);
    ensureSingleMode('uncensored', false);
  }

  getActiveModeMemory(user, mode = null) {
    this.ensureModeMemory(user);
    const activeMode = this.normalizeMode(mode || user?.profile?.mode || 'normal');
    return {
      activeMode,
      bucket: user.profile.modeMemory[activeMode],
    };
  }

  syncLegacyProfileFromMode(user, mode = null) {
    const { bucket } = this.getActiveModeMemory(user, mode);
    user.profile.goals = Array.isArray(bucket.goals) ? [...bucket.goals] : [];
    user.profile.notes = Array.isArray(bucket.notes) ? [...bucket.notes] : [];
    user.profile.pinnedMemories = Array.isArray(bucket.pinnedMemories) ? [...bucket.pinnedMemories] : [];
    user.profile.memoryMeta = {
      goals: { ...(bucket?.memoryMeta?.goals || {}) },
      pinnedMemories: { ...(bucket?.memoryMeta?.pinnedMemories || {}) },
    };
  }

  ensureMemoryMeta(user, mode = null) {
    const { bucket } = this.getActiveModeMemory(user, mode);
    if (!bucket.memoryMeta || typeof bucket.memoryMeta !== 'object') {
      bucket.memoryMeta = {};
    }
    if (!bucket.memoryMeta.goals || typeof bucket.memoryMeta.goals !== 'object') {
      bucket.memoryMeta.goals = {};
    }
    if (!bucket.memoryMeta.pinnedMemories || typeof bucket.memoryMeta.pinnedMemories !== 'object') {
      bucket.memoryMeta.pinnedMemories = {};
    }
  }

  touchMemoryMeta(user, targetBucket, key, score = 0.6, mode = null) {
    if (!key || !targetBucket) return;

    this.ensureMemoryMeta(user, mode);
    const { bucket } = this.getActiveModeMemory(user, mode);
    const normalizedScore = Math.max(0, Math.min(1, Number(score) || 0.6));
    bucket.memoryMeta[targetBucket][key] = {
      score: normalizedScore,
      updatedAt: new Date().toISOString(),
    };
  }

  getDecayedMemoryScore(metaEntry, fallbackText = '') {
    const baseScore = Math.max(0, Math.min(1, Number(metaEntry?.score) || this.scoreMemoryQuality(fallbackText)));
    const updatedAt = Date.parse(metaEntry?.updatedAt || '');
    if (Number.isNaN(updatedAt)) return baseScore;

    const ageDays = Math.max(0, (Date.now() - updatedAt) / (1000 * 60 * 60 * 24));
    const decay = Math.max(0, 1 - (ageDays / Math.max(1, this.memoryDecayDays)));
    return baseScore * decay;
  }

  applyMemoryDecayAndForgetting(user) {
    this.ensureModeMemory(user);

    const applyBucket = (modeBucket, bucketName, values = []) => {
      const kept = [];
      const existingMeta = modeBucket?.memoryMeta?.[bucketName] || {};
      const nextMeta = {};

      for (const rawValue of values) {
        const value = this.normalizeMemoryText(rawValue);
        if (!value) continue;

        const entry = existingMeta[value];
        const decayedScore = this.getDecayedMemoryScore(entry, value);

        if (decayedScore >= this.memoryForgetThreshold) {
          kept.push(value);
          nextMeta[value] = {
            score: Math.max(decayedScore, this.scoreMemoryQuality(value)),
            updatedAt: entry?.updatedAt || new Date().toISOString(),
          };
        }
      }

      if (!modeBucket.memoryMeta || typeof modeBucket.memoryMeta !== 'object') {
        modeBucket.memoryMeta = { goals: {}, pinnedMemories: {} };
      }
      modeBucket.memoryMeta[bucketName] = nextMeta;
      return kept;
    };

    const modes = ['normal', 'uncensored'];
    for (const modeName of modes) {
      const modeBucket = user.profile.modeMemory[modeName];
      modeBucket.goals = applyBucket(modeBucket, 'goals', modeBucket.goals || []).slice(-8);
      modeBucket.pinnedMemories = applyBucket(modeBucket, 'pinnedMemories', modeBucket.pinnedMemories || []).slice(-40);
      modeBucket.notes = Array.isArray(modeBucket.notes) ? modeBucket.notes.slice(-this.notesLimit) : [];
    }

    this.syncLegacyProfileFromMode(user, user?.profile?.mode || 'normal');
  }

  defaultUserState() {
    return defaultUserStateOp(this);
  }

  normalizeUserState(user) {
    return normalizeUserStateOp(this, user);
  }

  getUserState(userId = 'default') {
    return getUserStateOp(this, userId);
  }

  addNote(user, note, mode = null) {
    const { activeMode, bucket } = this.getActiveModeMemory(user, mode);
    const existing = bucket.notes || [];
    if (!existing.includes(note)) {
      existing.push(note);
    }
    bucket.notes = existing.slice(-this.notesLimit);
    this.syncLegacyProfileFromMode(user, activeMode);
  }

  addPinnedMemory(user, memoryText, maxPinnedMemories = 40, qualityScore = null, mode = null) {
    const normalizedMemory = this.normalizeMemoryText(memoryText);
    if (!normalizedMemory) {
      return false;
    }

    const { activeMode, bucket } = this.getActiveModeMemory(user, mode);
    const current = Array.isArray(bucket?.pinnedMemories) ? bucket.pinnedMemories : [];
    if (!current.includes(normalizedMemory)) {
      current.push(normalizedMemory);
    }
    bucket.pinnedMemories = current.slice(-maxPinnedMemories);
    this.touchMemoryMeta(
      user,
      'pinnedMemories',
      normalizedMemory,
      qualityScore == null ? this.scoreMemoryQuality(normalizedMemory) : qualityScore,
      activeMode,
    );
    this.syncLegacyProfileFromMode(user, activeMode);
    return true;
  }

  updateProfileFromMessage(user, message, modeConfig = null) {
    const msg = (message || '').trim();
    const activeMode = this.normalizeMode(user?.profile?.mode || 'normal');
    const { bucket } = this.getActiveModeMemory(user, activeMode);
    const loaded = modeConfig || this.loadModeConfig();
    const fixedPreferredName = (loaded?.userProfile?.fixedPreferredName || '').trim();
    const maxPinnedMemories = Number(loaded?.memoryProfile?.maxPinnedMemories || 40);
    const doNotLearn = loaded?.memoryProfile?.doNotLearn || [];

    const roleplayActionPattern = /\*[^*]{2,}\*/;
    const roleplayNsfwPattern = /\b(k[üu]ss|kuss|nackt|brust|blow|sex|sexy|dominant|rollenspiel|roleplay|horny|naughty)\b/i;
    const roleplayLikely = activeMode === 'uncensored' && (roleplayActionPattern.test(msg) || roleplayNsfwPattern.test(msg));
    const explicitPermanentSave = /\b(merke dir dauerhaft|remember permanently|save permanently)\b/i.test(msg);

    // Roleplay should not hijack long-term behavior unless explicitly requested as permanent.
    if (roleplayLikely && !explicitPermanentSave) {
      this.syncLegacyProfileFromMode(user, activeMode);
      return;
    }

    const nameMatch = msg.match(/(ich hei[sß]e|my name is|call me|nenn mich|ich bin)\s+([a-zA-ZÄÖÜäöüß\-]+)/i);
    if (!fixedPreferredName && nameMatch?.[2]) {
      user.profile.preferredName = nameMatch[2];
      this.addNote(user, `Name preference set to ${nameMatch[2]}`, activeMode);
    }

    if (/risiko|drawdown|sicher/i.test(msg)) {
      this.addNote(user, 'User priorisiert konservatives Risiko.', activeMode);
    }

    if (/aggressiv|mehr trades|mehr risiko/i.test(msg)) {
      this.addNote(user, 'User möchte zeitweise aggressiveres Trading.', activeMode);
    }

    if (/k[uü]rzer|shorter|kurz und knapp/i.test(msg)) {
      user.profile.style = 'brief';
      this.addNote(user, 'Antwortstil: kurz und direkt.', activeMode);
    }

    if (/mehr details|ausf[uü]hrlich|longer/i.test(msg)) {
      user.profile.style = 'detailed';
      this.addNote(user, 'Antwortstil: detailreicher.', activeMode);
    }

    if (/mehr emoji|s[uü][sß]er|cute/i.test(msg)) {
      this.addNote(user, 'Wünscht süßeren Stil mit mehr Emojis.', activeMode);
    }

    if (/weniger emoji|seri[oö]ser|sachlicher/i.test(msg)) {
      this.addNote(user, 'Wünscht sachlicheren Stil mit weniger Emojis.', activeMode);
    }

    const goalMatch = msg.match(/(mein ziel ist|my goal is|ziel:)\s*(.+)$/i);
    if (goalMatch?.[2]) {
      const goal = goalMatch[2].slice(0, 100).trim();
      const goalQuality = this.shouldStoreMemory(goal, this.memoryQualityThreshold);
      if (goal && goalQuality.accept) {
        if (!bucket.goals.includes(goal)) {
          bucket.goals = [...bucket.goals, goal].slice(-8);
          this.addNote(user, `Neues Ziel gespeichert: ${goal} (quality ${goalQuality.score.toFixed(2)})`, activeMode);
        }
        this.touchMemoryMeta(user, 'goals', goal, goalQuality.score, activeMode);
      }
    }

    if (/(merke dir|remember this|wichtig:)/i.test(msg)) {
      const pinned = msg
        .replace(/^(merke dir|remember this|wichtig:)\s*/i, '')
        .trim()
        .slice(0, 180);
      const looksLikeNamePreference = /(my name is|call me|ich hei[sß]e|nenn mich|ich bin)/i.test(pinned);
      const looksLikeAssistantIdentity = /(your name|du bist|you are|assistant name|dein name|language|sprache)/i.test(pinned);

      const blockedByPolicy =
        (doNotLearn.includes('preferredName') && looksLikeNamePreference)
        || (doNotLearn.includes('assistantProfile') && looksLikeAssistantIdentity)
        || (doNotLearn.includes('assistantLanguage') && /language|sprache/i.test(pinned));

      if (pinned && !blockedByPolicy) {
        const memoryQuality = this.shouldStoreMemory(pinned, this.memoryQualityThreshold);
        if (memoryQuality.accept) {
          this.addPinnedMemory(user, pinned, maxPinnedMemories, memoryQuality.score, activeMode);
          this.addNote(user, `Pinned memory gespeichert (quality ${memoryQuality.score.toFixed(2)}).`, activeMode);
        } else {
          this.addNote(user, `Pinned memory verworfen (quality ${memoryQuality.score.toFixed(2)}).`, activeMode);
        }
      }
      this.addNote(user, `Merker: ${msg.slice(0, 120)}`, activeMode);
    }

    this.syncLegacyProfileFromMode(user, activeMode);
  }

  summarizeTurns(turns, reason = 'compaction') {
    if (!Array.isArray(turns) || turns.length === 0) {
      return null;
    }

    const text = turns
      .map((t) => `${t.user || ''} ${t.assistant || ''}`)
      .join(' ')
      .toLowerCase();

    const tags = [];
    if (/risiko|drawdown|sicher|konservativ/.test(text)) tags.push('risk-control');
    if (/aggressiv|mehr trades|mehr risiko/.test(text)) tags.push('risk-up');
    if (/emoji|cute|uwu|kaomoji/.test(text)) tags.push('tone-cute');
    if (/kurz|short|knapp/.test(text)) tags.push('style-brief');
    if (/detail|ausf[uü]hrlich|longer/.test(text)) tags.push('style-detailed');
    if (/ziel|goal/.test(text)) tags.push('goals');

    const first = (turns[0]?.user || '').slice(0, 120);
    const last = (turns[turns.length - 1]?.assistant || '').slice(0, 120);

    return {
      at: new Date().toISOString(),
      reason,
      count: turns.length,
      tags,
      summary: `Turns: ${turns.length}; first: "${first}"; last: "${last}"`,
    };
  }

  applyRetentionAndCompaction(user, historyKey = 'history', summariesKey = 'summaries') {
    const history = Array.isArray(user[historyKey]) ? user[historyKey] : [];
    const summaries = Array.isArray(user[summariesKey]) ? user[summariesKey] : [];

    const now = Date.now();
    const cutoff = now - this.historyRetentionDays * 24 * 60 * 60 * 1000;

    const fresh = [];
    const expired = [];

    for (const turn of history) {
      const at = Date.parse(turn.at || '');
      if (!Number.isNaN(at) && at < cutoff) {
        expired.push(turn);
      } else {
        fresh.push(turn);
      }
    }

    user[historyKey] = fresh;

    if (expired.length > 0) {
      const retentionSummary = this.summarizeTurns(expired, 'retention-cleanup');
      if (retentionSummary) {
        summaries.push(retentionSummary);
      }
    }

    while (user[historyKey].length > this.historyStoreLimit) {
      const chunkSize = Math.min(this.summaryChunkSize, user[historyKey].length - this.historyStoreLimit);
      const chunk = user[historyKey].slice(0, chunkSize);
      user[historyKey] = user[historyKey].slice(chunkSize);

      const compactSummary = this.summarizeTurns(chunk, 'history-compaction');
      if (compactSummary) {
        summaries.push(compactSummary);
      }
    }

    user[summariesKey] = summaries.slice(-this.summaryLimit);
  }

  resetUserState(userId = 'default') {
    return resetUserStateOp(this, userId);
  }

  setPreferredName(userId = 'default', preferredName = '') {
    return setPreferredNameOp(this, userId, preferredName);
  }

  setModeExtras(userId = 'default', { instructions, memories } = {}) {
    return setModeExtrasOp(this, userId, { instructions, memories });
  }

  addTrainingExample(userId = 'default', payload = {}) {
    const { memory, user } = this.getUserState(userId);
    const activeMode = this.normalizeMode(payload?.mode || user?.profile?.mode || 'normal');

    const nextExample = {
      at: new Date().toISOString(),
      mode: activeMode,
      source: String(payload?.source || 'manual').slice(0, 60),
      accepted: payload?.accepted !== false,
      user: String(payload?.user || '').trim().slice(0, 1000),
      assistant: String(payload?.assistant || '').trim().slice(0, 3500),
      userOriginal: String(payload?.userOriginal || '').trim().slice(0, 1000),
      assistantOriginal: String(payload?.assistantOriginal || '').trim().slice(0, 3500),
    };

    if (!nextExample.user || !nextExample.assistant) {
      throw new Error('user and assistant are required for training example');
    }

    const modeExtras = user.profile?.modeExtras && typeof user.profile.modeExtras === 'object'
      ? { ...user.profile.modeExtras }
      : {};
    const currentExamples = Array.isArray(modeExtras.trainingExamples)
      ? modeExtras.trainingExamples
      : [];

    modeExtras.trainingExamples = [...currentExamples, nextExample].slice(-300);
    user.profile.modeExtras = modeExtras;
    memory.users[userId] = user;
    this.saveMemory(memory);

    return {
      stored: true,
      total: modeExtras.trainingExamples.length,
      example: nextExample,
    };
  }

  getMemoryOverview(userId = 'default') {
    return getMemoryOverviewOp(this, userId);
  }

  pruneHistoryByDays(userId = 'default', days = 7, mode = 'all') {
    return pruneHistoryByDaysOp(this, userId, days, mode);
  }

  deleteByDate(userId = 'default', day = '', mode = 'all') {
    return deleteByDateOp(this, userId, day, mode);
  }

  deleteRecentDays(userId = 'default', days = 7, mode = 'all') {
    return deleteRecentDaysOp(this, userId, days, mode);
  }

  deleteByTag(userId = 'default', tag = '', mode = 'all') {
    return deleteByTagOp(this, userId, tag, mode);
  }

  deleteMemoryItem(userId = 'default', { mode = 'normal', memoryType = 'note', text = '' } = {}) {
    return deleteMemoryItemOp(this, userId, { mode, memoryType, text });
  }
}

export default MemoryManager;
