import fs from 'fs';
import path from 'path';

function unquote(value = '') {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';

  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

export function loadDotEnv({ cwd = process.cwd(), fileName = '.env', override = false } = {}) {
  const envPath = path.resolve(cwd, fileName);
  if (!fs.existsSync(envPath)) {
    return { loaded: false, envPath };
  }

  const raw = fs.readFileSync(envPath, 'utf8').replace(/^\uFEFF/, '');
  const lines = raw.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = String(line || '').trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const idx = trimmed.indexOf('=');
    if (idx < 1) continue;

    const key = trimmed.slice(0, idx).trim();
    const value = unquote(trimmed.slice(idx + 1));
    if (!key) continue;

    if (override || process.env[key] == null) {
      process.env[key] = value;
    }
  }

  return { loaded: true, envPath };
}

export default loadDotEnv;
