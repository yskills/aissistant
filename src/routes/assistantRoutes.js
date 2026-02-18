import express from 'express';
import crypto from 'crypto';
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { resolveRuntimeConfig } from '../config/runtimeConfig.js';
import { LoraTrainingGateway } from '../training/LoraTrainingGateway.js';

const UNCENSORED_MODE_PASSWORD = String(
  process.env.ASSISTANT_UNCENSORED_PASSWORD || '',
).trim();
const UNCENSORED_AUTH_WINDOW_MS = Number(process.env.UNCENSORED_AUTH_WINDOW_MS || 5 * 60 * 1000);
const UNCENSORED_AUTH_MAX_ATTEMPTS = Number(process.env.UNCENSORED_AUTH_MAX_ATTEMPTS || 5);
const uncensoredAuthAttempts = new Map();

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

function cleanupOldAuthAttempts(now = Date.now()) {
  for (const [ip, state] of uncensoredAuthAttempts.entries()) {
    if (!state || (now - state.firstAttemptAt) > UNCENSORED_AUTH_WINDOW_MS) {
      uncensoredAuthAttempts.delete(ip);
    }
  }
}

function isRateLimitedForUncensored(req) {
  const now = Date.now();
  cleanupOldAuthAttempts(now);
  const ip = getClientIp(req);
  const state = uncensoredAuthAttempts.get(ip);
  if (!state) return false;
  return state.count >= UNCENSORED_AUTH_MAX_ATTEMPTS;
}

function registerFailedUncensoredAuth(req) {
  const now = Date.now();
  const ip = getClientIp(req);
  const state = uncensoredAuthAttempts.get(ip);
  if (!state || (now - state.firstAttemptAt) > UNCENSORED_AUTH_WINDOW_MS) {
    uncensoredAuthAttempts.set(ip, { count: 1, firstAttemptAt: now });
    return;
  }
  state.count += 1;
  uncensoredAuthAttempts.set(ip, state);
}

function clearFailedUncensoredAuth(req) {
  uncensoredAuthAttempts.delete(getClientIp(req));
}

function safePasswordMatches(input, expected) {
  const inputHash = crypto.createHash('sha256').update(String(input || ''), 'utf8').digest();
  const expectedHash = crypto.createHash('sha256').update(String(expected || ''), 'utf8').digest();
  return crypto.timingSafeEqual(inputHash, expectedHash);
}

function normalizeCharacterId(value) {
  const id = String(value || '').trim().toLowerCase();
  if (!id) return 'luna';
  if (!/^[a-z0-9_-]{2,32}$/.test(id)) return 'luna';
  return id;
}

function getAssistantUserId(req) {
  const bodyCharacterId = req?.body?.characterId;
  const queryCharacterId = req?.query?.characterId;
  return normalizeCharacterId(bodyCharacterId || queryCharacterId || 'luna');
}

function buildModeStatePayload(modeState = {}) {
  return {
    mode: modeState.mode,
    character: modeState.character,
    characterId: modeState.characterId,
    characterDefinition: modeState.characterDefinition,
    tone: modeState.tone,
  };
}

function isTradingCharacter(modeState = {}) {
  const domain = String(modeState?.characterDefinition?.definition?.domain || '').toLowerCase();
  if (domain) return domain === 'trading' || domain === 'trade';

  const mission = String(modeState?.characterDefinition?.definition?.modeProfiles?.normal?.mission || '').toLowerCase();
  return /(trade|trading|alpaca|broker|portfolio)/.test(mission);
}

function buildTradingSnapshot({ account, orders, positions, formatUsd }) {
  return {
    account: {
      equity: formatUsd(account?.equity),
      cash: formatUsd(account?.cash),
      buyingPower: formatUsd(account?.buying_power),
      status: account?.status || 'unknown',
    },
    orders: {
      open: Array.isArray(orders) ? orders.length : 0,
    },
    positions: {
      count: Array.isArray(positions) ? positions.length : 0,
    },
  };
}

function buildPersonalSnapshot() {
  return {
    account: {
      equity: null,
      cash: null,
      buyingPower: null,
      status: 'n/a',
    },
    orders: {
      open: null,
    },
    positions: {
      count: null,
    },
    planner: {
      scope: 'personal',
      date: new Date().toISOString().slice(0, 10),
    },
  };
}

function parseLastJsonFromOutput(text = '') {
  const lines = String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (!line.startsWith('{') || !line.endsWith('}')) continue;
    try {
      return JSON.parse(line);
    } catch {
      // continue
    }
  }
  return null;
}

function parseTruthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase());
}

export default function createAssistantRouter({
  CompanionLLMService,
  AlpacaService,
  getAlpacaStatus,
  formatUsd,
  sendErrorResponse,
}) {
  const router = express.Router();
  const runtime = resolveRuntimeConfig();
  const loraGateway = new LoraTrainingGateway({ runtime });

  router.get('/brief', async (req, res) => {
    try {
      const userId = getAssistantUserId(req);
      const modeState = CompanionLLMService.getMode(userId);
      const tradingCharacter = isTradingCharacter(modeState);

      let alpaca = { status: 'disabled', connected: false };
      let snapshot = buildPersonalSnapshot();
      let checklist = [
        'Starte mit deinem wichtigsten Tagesziel',
        'Plane Termine mit Zeitblock und Puffer',
        'Beende jede Antwort mit einem nächsten konkreten Schritt',
      ];

      if (tradingCharacter) {
        const [alpacaStatus, account, orders, positions] = await Promise.all([
          getAlpacaStatus(),
          AlpacaService.getAccount().catch(() => null),
          AlpacaService.getOrders({ status: 'open', limit: 50 }).catch(() => []),
          AlpacaService.getPositions().catch(() => []),
        ]);

        alpaca = alpacaStatus;
        snapshot = buildTradingSnapshot({ account, orders, positions, formatUsd });
        checklist = [
          'Nur paper trading aktiv halten',
          'Max Risiko pro Trade klein halten',
          'Bei API-Fehlern keine neuen Orders senden',
        ];
      }

      const brief = {
        persona: {
          name: modeState.character,
          tone: modeState.tone,
        },
        mode: modeState.mode,
        llmEnabled: CompanionLLMService.isEnabled(),
        alpaca,
        account: snapshot.account,
        orders: snapshot.orders,
        positions: snapshot.positions,
        planner: snapshot.planner,
        checklist,
        timestamp: new Date().toISOString(),
      };

      return res.json({ ok: true, requestId: req.requestId, brief });
    } catch (error) {
      return sendErrorResponse(res, 500, error.message, req.requestId);
    }
  });

  router.post('/reset', (req, res) => {
    try {
      const user = CompanionLLMService.resetAllState(getAssistantUserId(req));
      return res.json({ ok: true, requestId: req.requestId, profile: user.profile });
    } catch (error) {
      return sendErrorResponse(res, 500, error.message, req.requestId);
    }
  });

  router.get('/settings', (req, res) => {
    try {
      const settings = CompanionLLMService.getSettings(getAssistantUserId(req));
      return res.json({ ok: true, requestId: req.requestId, settings });
    } catch (error) {
      return sendErrorResponse(res, 500, error.message, req.requestId);
    }
  });

  router.post('/settings', (req, res) => {
    try {
      const settings = CompanionLLMService.updateSettings(getAssistantUserId(req), req.body || {});
      return res.json({ ok: true, requestId: req.requestId, settings });
    } catch (error) {
      return sendErrorResponse(res, 500, error.message, req.requestId);
    }
  });

  router.post('/memory/prune', (req, res) => {
    try {
      const userId = getAssistantUserId(req);
      const { days, mode } = req.body || {};
      const overview = CompanionLLMService.pruneMemoryByDays(userId, days, mode);
      return res.json({ ok: true, requestId: req.requestId, memoryOverview: overview });
    } catch (error) {
      return sendErrorResponse(res, 500, error.message, req.requestId);
    }
  });

  router.post('/memory/delete-date', (req, res) => {
    try {
      const userId = getAssistantUserId(req);
      const { day, mode } = req.body || {};
      const overview = CompanionLLMService.deleteMemoryByDate(userId, day, mode);
      return res.json({ ok: true, requestId: req.requestId, memoryOverview: overview });
    } catch (error) {
      return sendErrorResponse(res, 500, error.message, req.requestId);
    }
  });

  router.post('/memory/delete-recent', (req, res) => {
    try {
      const userId = getAssistantUserId(req);
      const { days, mode } = req.body || {};
      const overview = CompanionLLMService.deleteRecentMemoryDays(userId, days, mode);
      return res.json({ ok: true, requestId: req.requestId, memoryOverview: overview });
    } catch (error) {
      return sendErrorResponse(res, 500, error.message, req.requestId);
    }
  });

  router.post('/memory/delete-tag', (req, res) => {
    try {
      const userId = getAssistantUserId(req);
      const { tag, mode } = req.body || {};
      const overview = CompanionLLMService.deleteMemoryByTag(userId, tag, mode);
      return res.json({ ok: true, requestId: req.requestId, memoryOverview: overview });
    } catch (error) {
      return sendErrorResponse(res, 500, error.message, req.requestId);
    }
  });

  router.post('/memory/delete-item', (req, res) => {
    try {
      const userId = getAssistantUserId(req);
      const { mode, memoryType, text } = req.body || {};
      const overview = CompanionLLMService.deleteSingleMemoryItem(userId, { mode, memoryType, text });
      return res.json({ ok: true, requestId: req.requestId, memoryOverview: overview });
    } catch (error) {
      return sendErrorResponse(res, 500, error.message, req.requestId);
    }
  });

  router.post('/profile', (req, res) => {
    try {
      const { preferredName } = req.body || {};
      const user = CompanionLLMService.setPreferredName(getAssistantUserId(req), preferredName);
      return res.json({ ok: true, requestId: req.requestId, profile: user.profile });
    } catch (error) {
      return sendErrorResponse(res, 500, error.message, req.requestId);
    }
  });

  router.get('/mode', (req, res) => {
    try {
      const modeState = CompanionLLMService.getMode(getAssistantUserId(req));
      return res.json({
        ok: true,
        requestId: req.requestId,
        ...buildModeStatePayload(modeState),
        uncensoredRequiresPassword: !!UNCENSORED_MODE_PASSWORD,
      });
    } catch (error) {
      return sendErrorResponse(res, 500, error.message, req.requestId);
    }
  });

  router.post('/mode', (req, res) => {
    try {
      const userId = getAssistantUserId(req);
      const { mode, password } = req.body || {};
      const targetMode = String(mode || '').toLowerCase();

      if (targetMode === 'uncensored' && UNCENSORED_MODE_PASSWORD) {
        if (isRateLimitedForUncensored(req)) {
          return sendErrorResponse(res, 429, 'Too many failed password attempts. Try again later.', req.requestId);
        }

        if (!safePasswordMatches(password, UNCENSORED_MODE_PASSWORD)) {
          registerFailedUncensoredAuth(req);
          return sendErrorResponse(res, 403, 'Invalid password for uncensored mode.', req.requestId);
        }

        clearFailedUncensoredAuth(req);
      }

      const modeState = CompanionLLMService.setMode(userId, mode);
      return res.json({
        ok: true,
        requestId: req.requestId,
        ...buildModeStatePayload(modeState),
        profile: modeState.profile,
        uncensoredRequiresPassword: !!UNCENSORED_MODE_PASSWORD,
      });
    } catch (error) {
      return sendErrorResponse(res, 500, error.message, req.requestId);
    }
  });

  router.get('/mode-extras', (req, res) => {
    try {
      const modeState = CompanionLLMService.getMode(getAssistantUserId(req));
      const modeExtras = modeState?.profile?.modeExtras || {
        uncensoredInstructions: [],
        uncensoredMemories: [],
      };

      return res.json({
        ok: true,
        requestId: req.requestId,
        modeExtras,
      });
    } catch (error) {
      return sendErrorResponse(res, 500, error.message, req.requestId);
    }
  });

  router.post('/mode-extras', (req, res) => {
    try {
      const userId = getAssistantUserId(req);
      const { instructions, memories } = req.body || {};
      const result = CompanionLLMService.setModeExtras(userId, { instructions, memories });
      return res.json({
        ok: true,
        requestId: req.requestId,
        modeExtras: result.modeExtras,
        profile: result.profile,
      });
    } catch (error) {
      return sendErrorResponse(res, 500, error.message, req.requestId);
    }
  });

  router.post('/web-search/preview', (req, res) => {
    try {
      const userId = getAssistantUserId(req);
      const { message } = req.body || {};
      const preview = CompanionLLMService.getWebSearchPreview(userId, message);
      return res.json({
        ok: true,
        requestId: req.requestId,
        preview,
      });
    } catch (error) {
      return sendErrorResponse(res, 500, error.message, req.requestId);
    }
  });

  router.post('/feedback', (req, res) => {
    try {
      const userId = getAssistantUserId(req);
      const { value, assistantMessage, userMessage, mode } = req.body || {};
      const result = CompanionLLMService.addMessageFeedback(userId, {
        value,
        assistantMessage,
        userMessage,
        mode,
      });
      return res.json({
        ok: true,
        requestId: req.requestId,
        feedback: result,
      });
    } catch (error) {
      return sendErrorResponse(res, 400, error.message, req.requestId);
    }
  });

  router.post('/training/example', (req, res) => {
    try {
      const userId = getAssistantUserId(req);
      const { mode, source, accepted, user, assistant, userOriginal, assistantOriginal } = req.body || {};
      const result = CompanionLLMService.addTrainingExample(userId, {
        mode,
        source,
        accepted,
        user,
        assistant,
        userOriginal,
        assistantOriginal,
      });

      return res.json({
        ok: true,
        requestId: req.requestId,
        training: result,
      });
    } catch (error) {
      return sendErrorResponse(res, 400, error.message, req.requestId);
    }
  });

  router.post('/training/prepare', (req, res) => {
    try {
      const result = spawnSync(runtime.npmCommand, ['run', 'train:prepare'], {
        cwd: runtime.scriptsWorkingDir,
        encoding: 'utf8',
        timeout: 10 * 60 * 1000,
        shell: process.platform === 'win32',
      });

      const stdout = String(result?.stdout || '').trim();
      const stderr = String(result?.stderr || '').trim();
      const exitCode = Number(result?.status ?? 1);

      if (exitCode !== 0) {
        return sendErrorResponse(
          res,
          500,
          `train:prepare failed (exit ${exitCode})${stderr ? `: ${stderr.slice(-400)}` : ''}`,
          req.requestId,
        );
      }

      return res.json({
        ok: true,
        requestId: req.requestId,
        training: {
          exitCode,
          stdoutTail: stdout.slice(-2000),
        },
      });
    } catch (error) {
      return sendErrorResponse(res, 500, error.message, req.requestId);
    }
  });

  router.post('/training/auto', (req, res) => {
    try {
      const minCurated = Math.max(1, Number(req?.body?.minCurated || process.env.TRAIN_MIN_CURATED || 20));
      const result = spawnSync(runtime.npmCommand, ['run', 'train:auto', '--', `--minCurated=${minCurated}`], {
        cwd: runtime.scriptsWorkingDir,
        encoding: 'utf8',
        timeout: 12 * 60 * 1000,
        shell: process.platform === 'win32',
      });

      const stdout = String(result?.stdout || '').trim();
      const stderr = String(result?.stderr || '').trim();
      const exitCode = Number(result?.status ?? 1);
      const parsed = parseLastJsonFromOutput(stdout);

      if (exitCode !== 0) {
        return sendErrorResponse(
          res,
          500,
          `train:auto failed (exit ${exitCode})${stderr ? `: ${stderr.slice(-400)}` : ''}`,
          req.requestId,
        );
      }

      return res.json({
        ok: true,
        requestId: req.requestId,
        training: {
          exitCode,
          minCurated,
          result: parsed,
          stdoutTail: stdout.slice(-2000),
        },
      });
    } catch (error) {
      return sendErrorResponse(res, 500, error.message, req.requestId);
    }
  });

  router.get('/training/lora/config', (req, res) => {
    try {
      return res.json({
        ok: true,
        requestId: req.requestId,
        lora: loraGateway.getPublicConfig(),
      });
    } catch (error) {
      return sendErrorResponse(res, 500, error.message, req.requestId);
    }
  });

  router.get('/training/lora/status', async (req, res) => {
    try {
      const jobId = String(req?.query?.jobId || '').trim();
      const reportFile = path.resolve(runtime.trainingReportsDir, 'lora-latest.json');
      const latest = fs.existsSync(reportFile)
        ? JSON.parse(fs.readFileSync(reportFile, 'utf8') || '{}')
        : null;

      if (!jobId) {
        return res.json({
          ok: true,
          requestId: req.requestId,
          lora: {
            latest,
          },
        });
      }

      const status = await loraGateway.getJobStatus(jobId);
      return res.json({
        ok: true,
        requestId: req.requestId,
        lora: {
          latest,
          status,
        },
      });
    } catch (error) {
      return sendErrorResponse(res, 500, error.message, req.requestId);
    }
  });

  router.post('/training/lora/start', (req, res) => {
    try {
      const body = req.body || {};
      const datasetTier = String(body.datasetTier || runtime?.lora?.defaultDatasetTier || 'curated').trim().toLowerCase();
      const minCurated = Math.max(1, Number(body.minCurated || runtime.trainMinCurated || 20));
      const baseModel = String(body.baseModel || runtime?.lora?.defaultBaseModel || '').trim();
      const adapterName = String(body.adapterName || runtime?.lora?.defaultAdapterName || 'luna-adapter').trim();
      const dryRun = parseTruthy(body.dryRun);
      const skipEval = parseTruthy(body.skipEval);
      const skipExport = parseTruthy(body.skipExport);
      const learningRate = Number(body.learningRate);
      const epochs = Number(body.epochs);
      const batchSize = Number(body.batchSize);
      const rank = Number(body.rank);
      const alpha = Number(body.alpha);
      const dropout = Number(body.dropout);

      const args = ['run', 'train:lora', '--', `--datasetTier=${datasetTier}`, `--minCurated=${minCurated}`];
      if (baseModel) args.push(`--baseModel=${baseModel}`);
      if (adapterName) args.push(`--adapterName=${adapterName}`);
      if (dryRun) args.push('--dryRun');
      if (skipEval) args.push('--skipEval');
      if (skipExport) args.push('--skipExport');
      if (Number.isFinite(learningRate)) args.push(`--learningRate=${learningRate}`);
      if (Number.isFinite(epochs)) args.push(`--epochs=${epochs}`);
      if (Number.isFinite(batchSize)) args.push(`--batchSize=${batchSize}`);
      if (Number.isFinite(rank)) args.push(`--rank=${rank}`);
      if (Number.isFinite(alpha)) args.push(`--alpha=${alpha}`);
      if (Number.isFinite(dropout)) args.push(`--dropout=${dropout}`);

      const result = spawnSync(runtime.npmCommand, args, {
        cwd: runtime.scriptsWorkingDir,
        encoding: 'utf8',
        timeout: 20 * 60 * 1000,
        shell: process.platform === 'win32',
      });

      const stdout = String(result?.stdout || '').trim();
      const stderr = String(result?.stderr || '').trim();
      const exitCode = Number(result?.status ?? 1);
      const parsed = parseLastJsonFromOutput(stdout);

      if (exitCode !== 0) {
        return sendErrorResponse(
          res,
          500,
          `train:lora failed (exit ${exitCode})${stderr ? `: ${stderr.slice(-400)}` : ''}`,
          req.requestId,
        );
      }

      return res.json({
        ok: true,
        requestId: req.requestId,
        training: {
          exitCode,
          result: parsed,
          stdoutTail: stdout.slice(-2500),
        },
      });
    } catch (error) {
      return sendErrorResponse(res, 500, error.message, req.requestId);
    }
  });

  router.post('/chat', async (req, res) => {
    try {
      const { message, mode } = req.body || {};
      const userId = getAssistantUserId(req);
      const modeState = CompanionLLMService.getMode(userId);
      const tradingCharacter = isTradingCharacter(modeState);

      let brief = buildPersonalSnapshot();
      if (tradingCharacter) {
        const [account, orders, positions] = await Promise.all([
          AlpacaService.getAccount().catch(() => null),
          AlpacaService.getOrders({ status: 'open', limit: 50 }).catch(() => []),
          AlpacaService.getPositions().catch(() => []),
        ]);

        brief = buildTradingSnapshot({ account, orders, positions, formatUsd });
      }

      let assistantResult;
      try {
        assistantResult = await CompanionLLMService.chat({
          message,
          snapshot: brief,
          userId,
          mode,
        });
      } catch (llmError) {
        return res.status(503).json({
          ok: false,
          requestId: req.requestId,
          error: {
            message: `LLM unavailable: ${llmError.message}`,
          },
        });
      }

      return res.json({
        ok: true,
        requestId: req.requestId,
        reply: assistantResult.reply,
        profile: assistantResult.profile,
        llmEnabled: assistantResult.llmEnabled,
        ...buildModeStatePayload(assistantResult),
        meta: assistantResult.meta || { webSearchUsed: false },
        snapshot: brief,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      return sendErrorResponse(res, 500, error.message, req.requestId);
    }
  });

  router.get('/characters', (req, res) => {
    try {
      const result = CompanionLLMService.getCharacterDefinitions();
      return res.json({
        ok: true,
        requestId: req.requestId,
        defaultCharacterId: result.defaultCharacterId,
        characters: result.characters,
      });
    } catch (error) {
      return sendErrorResponse(res, 500, error.message, req.requestId);
    }
  });

  return router;
}
