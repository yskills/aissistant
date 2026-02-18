import fs from 'fs';
import path from 'path';

class JsonMemoryStore {
  constructor({ filePath, defaultKey = 'assistant-memory' } = {}) {
    this.filePath = filePath;
    this.dirPath = path.dirname(filePath || '');
    this.defaultKey = defaultKey;
  }

  readRawState() {
    try {
      if (!this.filePath || !fs.existsSync(this.filePath)) {
        return {};
      }
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw || '{}');
      return (parsed && typeof parsed === 'object') ? parsed : {};
    } catch {
      return {};
    }
  }

  writeRawState(state) {
    if (!this.filePath) {
      throw new Error('JsonMemoryStore requires filePath');
    }
    if (!fs.existsSync(this.dirPath)) {
      fs.mkdirSync(this.dirPath, { recursive: true });
    }
    fs.writeFileSync(this.filePath, JSON.stringify(state, null, 2), 'utf8');
  }

  readState(key, fallbackValue = null) {
    const state = this.readRawState();
    if (!key) {
      return fallbackValue;
    }
    if (!(key in state)) {
      return fallbackValue;
    }
    return state[key];
  }

  writeState(key, value) {
    if (!key) {
      throw new Error('JsonMemoryStore.writeState requires key');
    }
    const state = this.readRawState();
    state[key] = value;
    this.writeRawState(state);
  }

  deleteState(key) {
    if (!key) {
      return;
    }
    const state = this.readRawState();
    if (key in state) {
      delete state[key];
      this.writeRawState(state);
    }
  }

  ping() {
    return true;
  }

  read() {
    return this.readState(this.defaultKey, { users: {} });
  }

  write(memory) {
    this.writeState(this.defaultKey, memory);
  }
}

export default JsonMemoryStore;
