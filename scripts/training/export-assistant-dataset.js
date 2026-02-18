import fs from 'fs';
import path from 'path';
import CompanionLLMService from '../../src/services/CompanionLLMService.js';

const OUTPUT_DIR = path.resolve(process.cwd(), 'data', 'training');
const OUTPUT_FILE_MERGED = path.join(OUTPUT_DIR, 'assistant-sft.jsonl');
const OUTPUT_FILE_CURATED = path.join(OUTPUT_DIR, 'assistant-sft-curated.jsonl');
const OUTPUT_FILE_MEMORY = path.join(OUTPUT_DIR, 'assistant-sft-memory.jsonl');

function normalizeText(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function isUsablePair(userText = '', assistantText = '') {
  const u = normalizeText(userText);
  const a = normalizeText(assistantText);
  if (!u || !a) return false;
  if (u.length < 3 || a.length < 8) return false;
  if (a.length > 3500) return false;
  return true;
}

function toJsonlLine(pair) {
  return JSON.stringify({
    messages: [
      { role: 'user', content: pair.user },
      { role: 'assistant', content: pair.assistant },
    ],
    meta: {
      userId: pair.userId,
      mode: pair.mode,
      source: pair.source,
      at: pair.at,
    },
  });
}

function dedupePairs(pairs = []) {
  const seen = new Set();
  return (Array.isArray(pairs) ? pairs : []).filter((pair) => {
    const key = `${pair.mode}::${pair.user}::${pair.assistant}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function collectPairs(memory = { users: {} }) {
  const memoryPairs = [];
  const curatedPairs = [];
  const users = memory?.users && typeof memory.users === 'object' ? memory.users : {};

  Object.entries(users).forEach(([userId, user]) => {
    const normalHistory = Array.isArray(user?.history) ? user.history : [];
    const uncensoredHistory = Array.isArray(user?.uncensoredHistory) ? user.uncensoredHistory : [];

    normalHistory.forEach((turn) => {
      if (!isUsablePair(turn?.user, turn?.assistant)) return;
      memoryPairs.push({
        userId,
        mode: 'normal',
        source: 'history',
        at: String(turn?.at || ''),
        user: normalizeText(turn.user),
        assistant: normalizeText(turn.assistant),
      });
    });

    uncensoredHistory.forEach((turn) => {
      if (!isUsablePair(turn?.user, turn?.assistant)) return;
      memoryPairs.push({
        userId,
        mode: 'uncensored',
        source: 'uncensoredHistory',
        at: String(turn?.at || ''),
        user: normalizeText(turn.user),
        assistant: normalizeText(turn.assistant),
      });
    });

    const trainingExamples = Array.isArray(user?.profile?.modeExtras?.trainingExamples)
      ? user.profile.modeExtras.trainingExamples
      : [];

    trainingExamples.forEach((item) => {
      if (!item || item.accepted === false) return;
      if (!isUsablePair(item?.user, item?.assistant)) return;
      curatedPairs.push({
        userId,
        mode: String(item?.mode || 'normal').toLowerCase() === 'uncensored' ? 'uncensored' : 'normal',
        source: String(item?.source || 'trainingExample'),
        at: String(item?.at || ''),
        user: normalizeText(item.user),
        assistant: normalizeText(item.assistant),
      });
    });
  });

  const curated = dedupePairs(curatedPairs);
  const memoryOnly = dedupePairs(memoryPairs);
  const merged = dedupePairs([...curated, ...memoryOnly]);

  return {
    curated,
    memoryOnly,
    merged,
  };
}

function writeJsonlFile(filePath, pairs = []) {
  const jsonl = (Array.isArray(pairs) ? pairs : []).map(toJsonlLine).join('\n');
  fs.writeFileSync(filePath, `${jsonl}${jsonl ? '\n' : ''}`, 'utf8');
}

function main() {
  const memory = CompanionLLMService.loadMemory();
  const datasets = collectPairs(memory);

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  writeJsonlFile(OUTPUT_FILE_CURATED, datasets.curated);
  writeJsonlFile(OUTPUT_FILE_MEMORY, datasets.memoryOnly);
  writeJsonlFile(OUTPUT_FILE_MERGED, datasets.merged);

  const summary = {
    generatedAt: new Date().toISOString(),
    outputFiles: {
      curated: OUTPUT_FILE_CURATED,
      memoryOnly: OUTPUT_FILE_MEMORY,
      merged: OUTPUT_FILE_MERGED,
    },
    samples: {
      curated: datasets.curated.length,
      memoryOnly: datasets.memoryOnly.length,
      merged: datasets.merged.length,
    },
    users: Object.keys(memory?.users || {}).length,
  };

  console.log(JSON.stringify(summary, null, 2));
}

main();
