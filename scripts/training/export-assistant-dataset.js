import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  assertFileExists,
  ensureDirectory,
  resolveRuntimeConfig,
} from '../../src/config/runtimeConfig.js';

const runtime = resolveRuntimeConfig();
const OUTPUT_DIR = runtime.trainingDir;
const OUTPUT_FILE_MERGED = path.join(OUTPUT_DIR, 'assistant-sft.jsonl');
const OUTPUT_FILE_CURATED = path.join(OUTPUT_DIR, 'assistant-sft-curated.jsonl');
const OUTPUT_FILE_MEMORY = path.join(OUTPUT_DIR, 'assistant-sft-memory.jsonl');
const OUTPUT_FILE_CURATED_TRAIN = path.join(OUTPUT_DIR, 'assistant-sft-curated-train.jsonl');
const OUTPUT_FILE_CURATED_VAL = path.join(OUTPUT_DIR, 'assistant-sft-curated-val.jsonl');
const OUTPUT_FILE_CURATED_TEST = path.join(OUTPUT_DIR, 'assistant-sft-curated-test.jsonl');
const OUTPUT_FILE_SUMMARY = path.join(OUTPUT_DIR, 'assistant-sft-summary.json');

const DEFAULT_VAL_RATIO = Number(process.env.ASSISTANT_TRAIN_VAL_RATIO || 0.1);
const DEFAULT_TEST_RATIO = Number(process.env.ASSISTANT_TRAIN_TEST_RATIO || 0.0);

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
      datasetTier: pair.datasetTier || 'memory',
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

function clampRatio(value = 0, min = 0, max = 0.9) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function stableBucketNumber(pair = {}) {
  const key = `${pair.mode || 'normal'}::${pair.user || ''}::${pair.assistant || ''}`;
  const digest = crypto.createHash('sha1').update(key).digest('hex');
  const first8 = digest.slice(0, 8);
  const intValue = Number.parseInt(first8, 16);
  const max = 0xffffffff;
  return intValue / max;
}

function splitCuratedPairs(curated = [], valRatio = DEFAULT_VAL_RATIO, testRatio = DEFAULT_TEST_RATIO) {
  const normalizedTestRatio = clampRatio(testRatio, 0, 0.4);
  const normalizedValRatio = clampRatio(valRatio, 0, 0.4);
  const totalHoldout = Math.min(0.8, normalizedValRatio + normalizedTestRatio);

  const result = {
    train: [],
    val: [],
    test: [],
    ratios: {
      val: normalizedValRatio,
      test: normalizedTestRatio,
      train: 1 - totalHoldout,
    },
  };

  for (const pair of Array.isArray(curated) ? curated : []) {
    const bucket = stableBucketNumber(pair);
    if (bucket < normalizedTestRatio) {
      result.test.push(pair);
      continue;
    }
    if (bucket < normalizedTestRatio + normalizedValRatio) {
      result.val.push(pair);
      continue;
    }
    result.train.push(pair);
  }

  const curatedCount = Array.isArray(curated) ? curated.length : 0;
  if (normalizedValRatio > 0 && curatedCount >= 10 && result.val.length === 0 && result.train.length > 1) {
    result.val.push(result.train.pop());
  }

  if (result.train.length === 0 && (result.val.length > 0 || result.test.length > 0)) {
    const fallback = result.val.pop() || result.test.pop();
    if (fallback) result.train.push(fallback);
  }

  return result;
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
        datasetTier: 'memory',
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
        datasetTier: 'memory',
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
        datasetTier: 'curated',
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

async function main() {
  assertFileExists(runtime.modeConfigFile, 'assistant mode config file');
  const module = await import('../../src/services/CompanionLLMService.js');
  const CompanionLLMService = module.default;
  const memory = CompanionLLMService.loadMemory();
  const datasets = collectPairs(memory);

  ensureDirectory(OUTPUT_DIR);

  writeJsonlFile(OUTPUT_FILE_CURATED, datasets.curated);
  writeJsonlFile(OUTPUT_FILE_MEMORY, datasets.memoryOnly);
  writeJsonlFile(OUTPUT_FILE_MERGED, datasets.merged);

  const curatedSplit = splitCuratedPairs(datasets.curated, DEFAULT_VAL_RATIO, DEFAULT_TEST_RATIO);
  writeJsonlFile(OUTPUT_FILE_CURATED_TRAIN, curatedSplit.train);
  writeJsonlFile(OUTPUT_FILE_CURATED_VAL, curatedSplit.val);
  writeJsonlFile(OUTPUT_FILE_CURATED_TEST, curatedSplit.test);

  const summary = {
    generatedAt: new Date().toISOString(),
    outputFiles: {
      curated: OUTPUT_FILE_CURATED,
      curatedTrain: OUTPUT_FILE_CURATED_TRAIN,
      curatedVal: OUTPUT_FILE_CURATED_VAL,
      curatedTest: OUTPUT_FILE_CURATED_TEST,
      memoryOnly: OUTPUT_FILE_MEMORY,
      merged: OUTPUT_FILE_MERGED,
      summary: OUTPUT_FILE_SUMMARY,
    },
    samples: {
      curated: datasets.curated.length,
      curatedTrain: curatedSplit.train.length,
      curatedVal: curatedSplit.val.length,
      curatedTest: curatedSplit.test.length,
      memoryOnly: datasets.memoryOnly.length,
      merged: datasets.merged.length,
    },
    split: {
      strategy: 'deterministic-hash',
      seed: 'sha1(mode::user::assistant)',
      ratios: curatedSplit.ratios,
    },
    users: Object.keys(memory?.users || {}).length,
  };

  fs.writeFileSync(OUTPUT_FILE_SUMMARY, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
