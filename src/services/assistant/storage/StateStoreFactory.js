import SqliteMemoryStore from './SqliteMemoryStore.js';

class StateStoreFactory {
  static create({
    backend = 'sqlite',
    sqliteFilePath,
    defaultKey = 'assistant-memory',
  } = {}) {
    const normalized = String(backend || 'sqlite').toLowerCase();

    if (normalized !== 'sqlite') {
      throw new Error('Only MEMORY_BACKEND=sqlite is supported. JSON fallback is disabled by design.');
    }

    return new SqliteMemoryStore({
      dbPath: sqliteFilePath,
      defaultKey,
    });
  }
}

export default StateStoreFactory;
