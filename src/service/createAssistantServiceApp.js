import express from 'express';
import crypto from 'crypto';
import CompanionLLMService from '../services/CompanionLLMService.js';
import createAssistantRouter from '../routes/assistantRoutes.js';

function defaultSendErrorResponse(res, statusCode, message, requestId) {
  return res.status(statusCode).json({
    ok: false,
    requestId,
    error: { message },
  });
}

function defaultFormatUsd(value) {
  if (value == null || value === '') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  return `$${numeric.toFixed(2)}`;
}

export function createAssistantServiceApp({
  CompanionService = CompanionLLMService,
  AlpacaService = {
    getAccount: async () => null,
    getOrders: async () => [],
    getPositions: async () => [],
  },
  getAlpacaStatus = async () => ({ status: 'disabled', connected: false }),
  formatUsd = defaultFormatUsd,
  sendErrorResponse = defaultSendErrorResponse,
  mountPath = '/assistant',
  jsonLimit = '1mb',
  enableCors = false,
} = {}) {
  const app = express();

  app.use((req, _res, next) => {
    req.requestId = req.headers['x-request-id'] || crypto.randomUUID();
    next();
  });

  if (enableCors) {
    app.use((req, res, next) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Request-Id');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
      if (req.method === 'OPTIONS') {
        return res.status(204).end();
      }
      return next();
    });
  }

  app.use(express.json({ limit: jsonLimit }));
  app.use(mountPath, createAssistantRouter({
    CompanionLLMService: CompanionService,
    AlpacaService,
    getAlpacaStatus,
    formatUsd,
    sendErrorResponse,
  }));
  return app;
}

export default createAssistantServiceApp;
