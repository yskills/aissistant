import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

function buildRequireCandidates() {
  const candidatePackageFiles = [
    path.resolve(process.cwd(), 'package.json'),
    path.resolve(process.cwd(), 'backend', 'package.json'),
    path.resolve(process.cwd(), '..', 'backend', 'package.json'),
    path.resolve(process.cwd(), '..', 'package.json'),
  ];

  return candidatePackageFiles
    .filter((filePath) => fs.existsSync(filePath))
    .map((filePath) => createRequire(filePath));
}

class SqliteMemoryStore {
  constructor({ dbPath, defaultKey = 'assistant-memory' } = {}) {
    if (!dbPath) {
      throw new Error('SqliteMemoryStore requires dbPath');
    }

    this.dbPath = dbPath;
    this.dirPath = path.dirname(dbPath);
    this.defaultKey = defaultKey;

    if (!fs.existsSync(this.dirPath)) {
      fs.mkdirSync(this.dirPath, { recursive: true });
    }

    const requireFromModule = createRequire(import.meta.url);
    const requireCandidates = buildRequireCandidates();

    let Database;
    try {
      Database = requireFromModule('better-sqlite3');
    } catch {
      for (const resolver of requireCandidates) {
        try {
          Database = resolver('better-sqlite3');
          break;
        } catch {
          // continue
        }
      }
      if (!Database) {
        throw new Error('MEMORY_BACKEND=sqlite requires dependency better-sqlite3. Run: npm i better-sqlite3 in host project.');
      }
    }

    this.db = new Database(this.dbPath);
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('journal_mode = WAL');

    this.db.prepare(`
      CREATE TABLE IF NOT EXISTS assistant_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `).run();

    this.db.prepare(`
      CREATE TABLE IF NOT EXISTS assistant_users (
        user_id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `).run();

    this.db.prepare(`
      CREATE TABLE IF NOT EXISTS assistant_profiles (
        user_id TEXT PRIMARY KEY,
        mode TEXT NOT NULL,
        preferred_name TEXT NOT NULL,
        style TEXT NOT NULL,
        mode_extras_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES assistant_users(user_id) ON DELETE CASCADE
      )
    `).run();

    this.db.prepare(`
      CREATE TABLE IF NOT EXISTS assistant_memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        mode TEXT NOT NULL,
        memory_type TEXT NOT NULL,
        text_value TEXT NOT NULL,
        score REAL NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        UNIQUE(user_id, mode, memory_type, text_value),
        FOREIGN KEY (user_id) REFERENCES assistant_users(user_id) ON DELETE CASCADE
      )
    `).run();
    this.db.prepare('CREATE INDEX IF NOT EXISTS idx_memories_user_mode_type ON assistant_memories(user_id, mode, memory_type)').run();

    this.db.prepare(`
      CREATE TABLE IF NOT EXISTS assistant_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        mode TEXT NOT NULL,
        user_text TEXT NOT NULL,
        assistant_text TEXT NOT NULL,
        event_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES assistant_users(user_id) ON DELETE CASCADE
      )
    `).run();
    this.db.prepare('CREATE INDEX IF NOT EXISTS idx_history_user_mode_time ON assistant_history(user_id, mode, event_at)').run();

    this.db.prepare(`
      CREATE TABLE IF NOT EXISTS assistant_summaries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        mode TEXT NOT NULL,
        reason TEXT NOT NULL,
        tags_json TEXT NOT NULL,
        summary_text TEXT NOT NULL,
        turn_count INTEGER NOT NULL,
        event_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES assistant_users(user_id) ON DELETE CASCADE
      )
    `).run();
    this.db.prepare('CREATE INDEX IF NOT EXISTS idx_summaries_user_mode_time ON assistant_summaries(user_id, mode, event_at)').run();

    this.migrateLegacyBlobIfNeeded();
  }

  nowIso() {
    return new Date().toISOString();
  }

  normalizeMode(mode = '') {
    const value = String(mode || '').toLowerCase();
    return value === 'uncensored' ? 'uncensored' : 'normal';
  }

  parseJsonSafe(raw, fallbackValue) {
    try {
      return JSON.parse(raw);
    } catch {
      return fallbackValue;
    }
  }

  sanitizeVoiceSettings(input = {}) {
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

  ensureModeMemory(profile = {}) {
    const modeMemory = (profile?.modeMemory && typeof profile.modeMemory === 'object')
      ? profile.modeMemory
      : {
        normal: this.buildModeMemoryDefaults(true),
        uncensored: this.buildModeMemoryDefaults(false),
      };

    const normalizeBucket = (bucket = {}, includeSeedGoal = false) => {
      const defaults = this.buildModeMemoryDefaults(includeSeedGoal);
      const merged = {
        ...defaults,
        ...(bucket || {}),
      };

      merged.goals = Array.isArray(merged.goals)
        ? merged.goals.filter((v) => typeof v === 'string').map((v) => v.trim()).filter(Boolean).slice(-8)
        : defaults.goals;
      merged.notes = Array.isArray(merged.notes)
        ? merged.notes.filter((v) => typeof v === 'string').map((v) => v.trim()).filter(Boolean).slice(-10)
        : [];
      merged.pinnedMemories = Array.isArray(merged.pinnedMemories)
        ? merged.pinnedMemories.filter((v) => typeof v === 'string').map((v) => v.trim()).filter(Boolean).slice(-40)
        : [];
      merged.memoryMeta = {
        goals: (merged?.memoryMeta?.goals && typeof merged.memoryMeta.goals === 'object') ? merged.memoryMeta.goals : {},
        pinnedMemories: (merged?.memoryMeta?.pinnedMemories && typeof merged.memoryMeta.pinnedMemories === 'object') ? merged.memoryMeta.pinnedMemories : {},
      };

      return merged;
    };

    return {
      normal: normalizeBucket(modeMemory.normal, true),
      uncensored: normalizeBucket(modeMemory.uncensored, false),
    };
  }

  syncLegacyProfile(profile = {}) {
    const activeMode = this.normalizeMode(profile.mode);
    const modeMemory = this.ensureModeMemory(profile);
    const activeBucket = modeMemory[activeMode] || this.buildModeMemoryDefaults(activeMode === 'normal');

    return {
      ...profile,
      mode: activeMode,
      goals: [...(activeBucket.goals || [])],
      notes: [...(activeBucket.notes || [])],
      pinnedMemories: [...(activeBucket.pinnedMemories || [])],
      memoryMeta: {
        goals: { ...(activeBucket?.memoryMeta?.goals || {}) },
        pinnedMemories: { ...(activeBucket?.memoryMeta?.pinnedMemories || {}) },
      },
      modeMemory,
    };
  }

  normalizeMemoryObject(memory) {
    const base = (memory && typeof memory === 'object') ? memory : {};
    const users = (base.users && typeof base.users === 'object') ? base.users : {};

    const normalizedUsers = {};
    Object.keys(users).forEach((userId) => {
      const user = users[userId] || {};
      const rawProfile = user.profile || {};
      const profileWithModeMemory = this.syncLegacyProfile(rawProfile);

      normalizedUsers[userId] = {
        profile: {
          mode: profileWithModeMemory.mode,
          preferredName: String(profileWithModeMemory.preferredName || ''),
          style: String(profileWithModeMemory.style || 'playful-supportive'),
          goals: Array.isArray(profileWithModeMemory.goals) ? profileWithModeMemory.goals : ['daily structure and focus'],
          notes: Array.isArray(profileWithModeMemory.notes) ? profileWithModeMemory.notes : [],
          pinnedMemories: Array.isArray(profileWithModeMemory.pinnedMemories) ? profileWithModeMemory.pinnedMemories : [],
          memoryMeta: {
            goals: (profileWithModeMemory?.memoryMeta?.goals && typeof profileWithModeMemory.memoryMeta.goals === 'object')
              ? profileWithModeMemory.memoryMeta.goals
              : {},
            pinnedMemories: (profileWithModeMemory?.memoryMeta?.pinnedMemories && typeof profileWithModeMemory.memoryMeta.pinnedMemories === 'object')
              ? profileWithModeMemory.memoryMeta.pinnedMemories
              : {},
          },
          modeMemory: this.ensureModeMemory(profileWithModeMemory),
          modeExtras: {
            uncensoredInstructions: Array.isArray(profileWithModeMemory?.modeExtras?.uncensoredInstructions)
              ? profileWithModeMemory.modeExtras.uncensoredInstructions.filter((v) => typeof v === 'string').slice(-20)
              : [],
            uncensoredMemories: Array.isArray(profileWithModeMemory?.modeExtras?.uncensoredMemories)
              ? profileWithModeMemory.modeExtras.uncensoredMemories.filter((v) => typeof v === 'string').slice(-40)
              : [],
            trainingExamples: Array.isArray(profileWithModeMemory?.modeExtras?.trainingExamples)
              ? profileWithModeMemory.modeExtras.trainingExamples
                .filter((item) => item && typeof item === 'object')
                .map((item) => ({
                  at: String(item.at || this.nowIso()),
                  mode: this.normalizeMode(item.mode || 'normal'),
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
            voiceSettings: this.sanitizeVoiceSettings(profileWithModeMemory?.modeExtras?.voiceSettings),
          },
        },
        history: Array.isArray(user.history) ? user.history : [],
        summaries: Array.isArray(user.summaries) ? user.summaries : [],
        uncensoredHistory: Array.isArray(user.uncensoredHistory) ? user.uncensoredHistory : [],
        uncensoredSummaries: Array.isArray(user.uncensoredSummaries) ? user.uncensoredSummaries : [],
      };
    });

    return {
      users: normalizedUsers,
      _meta: (base._meta && typeof base._meta === 'object') ? base._meta : {},
    };
  }

  migrateLegacyBlobIfNeeded() {
    const hasLegacyTable = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='app_state'").get();
    if (!hasLegacyTable) {
      return;
    }

    const legacyRow = this.db.prepare('SELECT value FROM app_state WHERE key = ?').get(this.defaultKey);
    if (legacyRow?.value) {
      const parsed = this.parseJsonSafe(legacyRow.value, null);
      if (parsed && typeof parsed === 'object') {
        this.persistNormalizedMemory(parsed);
      }
    }

    this.db.prepare('DROP TABLE IF EXISTS app_state').run();
  }

  persistNormalizedMemory(memory) {
    const normalized = this.normalizeMemoryObject(memory);
    const now = this.nowIso();

    const writeTransaction = this.db.transaction(() => {
      this.db.prepare('DELETE FROM assistant_history').run();
      this.db.prepare('DELETE FROM assistant_summaries').run();
      this.db.prepare('DELETE FROM assistant_memories').run();
      this.db.prepare('DELETE FROM assistant_profiles').run();
      this.db.prepare('DELETE FROM assistant_users').run();

      const upsertUser = this.db.prepare(`
        INSERT INTO assistant_users (user_id, created_at, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET updated_at = excluded.updated_at
      `);

      const upsertProfile = this.db.prepare(`
        INSERT INTO assistant_profiles (user_id, mode, preferred_name, style, mode_extras_json, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          mode = excluded.mode,
          preferred_name = excluded.preferred_name,
          style = excluded.style,
          mode_extras_json = excluded.mode_extras_json,
          updated_at = excluded.updated_at
      `);

      const upsertMemory = this.db.prepare(`
        INSERT INTO assistant_memories (user_id, mode, memory_type, text_value, score, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, mode, memory_type, text_value) DO UPDATE SET
          score = excluded.score,
          updated_at = excluded.updated_at
      `);

      const insertHistory = this.db.prepare(`
        INSERT INTO assistant_history (user_id, mode, user_text, assistant_text, event_at)
        VALUES (?, ?, ?, ?, ?)
      `);

      const insertSummary = this.db.prepare(`
        INSERT INTO assistant_summaries (user_id, mode, reason, tags_json, summary_text, turn_count, event_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      Object.entries(normalized.users || {}).forEach(([userId, user]) => {
        const profile = user.profile || {};
        const modeMemory = this.ensureModeMemory(profile);

        upsertUser.run(userId, now, now);
        upsertProfile.run(
          userId,
          this.normalizeMode(profile.mode),
          String(profile.preferredName || ''),
          String(profile.style || 'playful-supportive'),
          JSON.stringify(profile.modeExtras || { uncensoredInstructions: [], uncensoredMemories: [], trainingExamples: [] }),
          now,
        );

        ['normal', 'uncensored'].forEach((mode) => {
          const bucket = modeMemory[mode] || this.buildModeMemoryDefaults(mode === 'normal');
          const goalsMeta = bucket?.memoryMeta?.goals || {};
          const pinnedMeta = bucket?.memoryMeta?.pinnedMemories || {};

          (bucket.goals || []).forEach((value) => {
            const text = String(value || '').trim();
            if (!text) return;
            const score = Number(goalsMeta?.[text]?.score || 0.6);
            const updatedAt = goalsMeta?.[text]?.updatedAt || now;
            upsertMemory.run(userId, mode, 'goal', text, score, updatedAt);
          });

          (bucket.notes || []).forEach((value) => {
            const text = String(value || '').trim();
            if (!text) return;
            upsertMemory.run(userId, mode, 'note', text, 0, now);
          });

          (bucket.pinnedMemories || []).forEach((value) => {
            const text = String(value || '').trim();
            if (!text) return;
            const score = Number(pinnedMeta?.[text]?.score || 0.6);
            const updatedAt = pinnedMeta?.[text]?.updatedAt || now;
            upsertMemory.run(userId, mode, 'pinned', text, score, updatedAt);
          });
        });

        (user.history || []).forEach((turn) => {
          insertHistory.run(
            userId,
            'normal',
            String(turn?.user || ''),
            String(turn?.assistant || ''),
            String(turn?.at || now),
          );
        });

        (user.uncensoredHistory || []).forEach((turn) => {
          insertHistory.run(
            userId,
            'uncensored',
            String(turn?.user || ''),
            String(turn?.assistant || ''),
            String(turn?.at || now),
          );
        });

        (user.summaries || []).forEach((entry) => {
          insertSummary.run(
            userId,
            'normal',
            String(entry?.reason || 'unknown'),
            JSON.stringify(Array.isArray(entry?.tags) ? entry.tags : []),
            String(entry?.summary || ''),
            Number(entry?.count || 0),
            String(entry?.at || now),
          );
        });

        (user.uncensoredSummaries || []).forEach((entry) => {
          insertSummary.run(
            userId,
            'uncensored',
            String(entry?.reason || 'unknown'),
            JSON.stringify(Array.isArray(entry?.tags) ? entry.tags : []),
            String(entry?.summary || ''),
            Number(entry?.count || 0),
            String(entry?.at || now),
          );
        });
      });

      this.db.prepare(`
        INSERT INTO assistant_meta (key, value, updated_at)
        VALUES ('memory_meta', ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at
      `).run(JSON.stringify(normalized._meta || {}), now);
    });

    writeTransaction();
  }

  hydrateMemoryFromTables() {
    const users = {};
    const userRows = this.db.prepare('SELECT user_id FROM assistant_users ORDER BY user_id ASC').all();
    if (!Array.isArray(userRows) || userRows.length === 0) {
      return { users: {}, _meta: {} };
    }

    const profileStmt = this.db.prepare('SELECT mode, preferred_name, style, mode_extras_json FROM assistant_profiles WHERE user_id = ?');
    const memoryStmt = this.db.prepare('SELECT mode, memory_type, text_value, score, updated_at FROM assistant_memories WHERE user_id = ? ORDER BY id ASC');
    const historyStmt = this.db.prepare('SELECT mode, user_text, assistant_text, event_at FROM assistant_history WHERE user_id = ? ORDER BY id ASC');
    const summaryStmt = this.db.prepare('SELECT mode, reason, tags_json, summary_text, turn_count, event_at FROM assistant_summaries WHERE user_id = ? ORDER BY id ASC');

    userRows.forEach(({ user_id: userId }) => {
      const profileRow = profileStmt.get(userId) || {};
      const modeMemory = {
        normal: this.buildModeMemoryDefaults(true),
        uncensored: this.buildModeMemoryDefaults(false),
      };

      const memoryRows = memoryStmt.all(userId);
      memoryRows.forEach((row) => {
        const mode = this.normalizeMode(row.mode);
        const bucket = modeMemory[mode] || this.buildModeMemoryDefaults(mode === 'normal');
        const text = String(row.text_value || '').trim();
        if (!text) return;

        if (row.memory_type === 'goal') {
          if (!bucket.goals.includes(text)) bucket.goals.push(text);
          bucket.memoryMeta.goals[text] = {
            score: Number(row.score || 0.6),
            updatedAt: String(row.updated_at || this.nowIso()),
          };
        } else if (row.memory_type === 'pinned') {
          if (!bucket.pinnedMemories.includes(text)) bucket.pinnedMemories.push(text);
          bucket.memoryMeta.pinnedMemories[text] = {
            score: Number(row.score || 0.6),
            updatedAt: String(row.updated_at || this.nowIso()),
          };
        } else if (row.memory_type === 'note') {
          if (!bucket.notes.includes(text)) bucket.notes.push(text);
        }

        modeMemory[mode] = bucket;
      });

      const historyRows = historyStmt.all(userId);
      const history = [];
      const uncensoredHistory = [];
      historyRows.forEach((row) => {
        const turn = {
          at: String(row.event_at || this.nowIso()),
          user: String(row.user_text || ''),
          assistant: String(row.assistant_text || ''),
        };
        if (this.normalizeMode(row.mode) === 'uncensored') {
          uncensoredHistory.push(turn);
        } else {
          history.push(turn);
        }
      });

      const summaryRows = summaryStmt.all(userId);
      const summaries = [];
      const uncensoredSummaries = [];
      summaryRows.forEach((row) => {
        const entry = {
          at: String(row.event_at || this.nowIso()),
          reason: String(row.reason || 'unknown'),
          tags: Array.isArray(this.parseJsonSafe(row.tags_json || '[]', []))
            ? this.parseJsonSafe(row.tags_json || '[]', [])
            : [],
          summary: String(row.summary_text || ''),
          count: Number(row.turn_count || 0),
        };
        if (this.normalizeMode(row.mode) === 'uncensored') {
          uncensoredSummaries.push(entry);
        } else {
          summaries.push(entry);
        }
      });

      const rawProfile = {
        mode: this.normalizeMode(profileRow.mode),
        preferredName: String(profileRow.preferred_name || ''),
        style: String(profileRow.style || 'playful-supportive'),
        modeMemory,
        modeExtras: this.parseJsonSafe(
          profileRow.mode_extras_json || '{"uncensoredInstructions":[],"uncensoredMemories":[],"trainingExamples":[]}',
          { uncensoredInstructions: [], uncensoredMemories: [], trainingExamples: [] },
        ),
      };

      const profile = this.syncLegacyProfile(rawProfile);

      users[userId] = {
        profile,
        history,
        summaries,
        uncensoredHistory,
        uncensoredSummaries,
      };
    });

    const metaRow = this.db.prepare("SELECT value FROM assistant_meta WHERE key = 'memory_meta'").get();
    const meta = metaRow?.value ? this.parseJsonSafe(metaRow.value, {}) : {};

    return {
      users,
      _meta: (meta && typeof meta === 'object') ? meta : {},
    };
  }

  readState(key, fallbackValue = null) {
    if (!key || key !== this.defaultKey) {
      return fallbackValue;
    }

    const hydrated = this.hydrateMemoryFromTables();
    if (!hydrated || typeof hydrated !== 'object') {
      return fallbackValue;
    }

    if (!hydrated.users || Object.keys(hydrated.users).length === 0) {
      return fallbackValue;
    }

    return hydrated;
  }

  writeState(key, value) {
    if (!key) {
      throw new Error('SqliteMemoryStore.writeState requires key');
    }
    if (key !== this.defaultKey) {
      throw new Error(`SqliteMemoryStore only supports key "${this.defaultKey}"`);
    }
    this.persistNormalizedMemory(value);
  }

  deleteState(key) {
    if (!key || key !== this.defaultKey) {
      return;
    }

    const clearTransaction = this.db.transaction(() => {
      this.db.prepare('DELETE FROM assistant_history').run();
      this.db.prepare('DELETE FROM assistant_summaries').run();
      this.db.prepare('DELETE FROM assistant_memories').run();
      this.db.prepare('DELETE FROM assistant_profiles').run();
      this.db.prepare('DELETE FROM assistant_users').run();
      this.db.prepare("DELETE FROM assistant_meta WHERE key = 'memory_meta'").run();
    });

    clearTransaction();
  }

  ping() {
    this.db.prepare('SELECT 1').get();
    return true;
  }

  read() {
    return this.readState(this.defaultKey, { users: {} });
  }

  write(memory) {
    this.writeState(this.defaultKey, memory);
  }
}

export default SqliteMemoryStore;
