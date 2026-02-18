class MemorySchemaManager {
  constructor({ currentVersion = 2 } = {}) {
    this.currentVersion = currentVersion;
  }

  ensureBase(memory) {
    const base = (memory && typeof memory === 'object') ? { ...memory } : {};
    base.users = (base.users && typeof base.users === 'object') ? base.users : {};
    base._meta = (base._meta && typeof base._meta === 'object') ? base._meta : {};
    return base;
  }

  ensureLatest(memory) {
    const base = this.ensureBase(memory);
    base._meta.schemaVersion = this.currentVersion;
    base._meta.updatedAt = new Date().toISOString();
    return base;
  }

  migrate(memory) {
    let next = this.ensureBase(memory);
    let changed = false;

    let version = Number(next?._meta?.schemaVersion || 1);
    if (!Number.isFinite(version) || version < 1) {
      version = 1;
    }

    if (version < 2) {
      next = this.migrateV1ToV2(next);
      version = 2;
      changed = true;
    }

    if (next?._meta?.schemaVersion !== this.currentVersion) {
      next._meta.schemaVersion = this.currentVersion;
      changed = true;
    }

    if (!next?._meta?.updatedAt) {
      next._meta.updatedAt = new Date().toISOString();
      changed = true;
    }

    return {
      memory: next,
      changed,
    };
  }

  migrateV1ToV2(memory) {
    const next = this.ensureBase(memory);

    const users = next.users || {};
    Object.keys(users).forEach((userId) => {
      const user = users[userId] || {};
      const profile = user.profile || {};

      if (!profile.modeMemory || typeof profile.modeMemory !== 'object') {
        profile.modeMemory = {
          normal: {
            goals: Array.isArray(profile.goals) ? profile.goals.slice(-8) : ['daily structure and focus'],
            notes: Array.isArray(profile.notes) ? profile.notes.slice(-10) : [],
            pinnedMemories: Array.isArray(profile.pinnedMemories) ? profile.pinnedMemories.slice(-40) : [],
            memoryMeta: {
              goals: (profile?.memoryMeta?.goals && typeof profile.memoryMeta.goals === 'object') ? profile.memoryMeta.goals : {},
              pinnedMemories: (profile?.memoryMeta?.pinnedMemories && typeof profile.memoryMeta.pinnedMemories === 'object') ? profile.memoryMeta.pinnedMemories : {},
            },
          },
          uncensored: {
            goals: [],
            notes: [],
            pinnedMemories: [],
            memoryMeta: {
              goals: {},
              pinnedMemories: {},
            },
          },
        };
      }

      user.profile = profile;
      users[userId] = user;
    });

    next.users = users;
    next._meta = {
      ...(next._meta || {}),
      schemaVersion: 2,
      updatedAt: new Date().toISOString(),
    };

    return next;
  }
}

export default MemorySchemaManager;
