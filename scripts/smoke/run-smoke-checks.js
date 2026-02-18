import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  API_VERSION,
  CompanionLLMServiceClass,
  LoraTrainingGateway,
  createAssistantRouter,
  createCompanionLLMService,
} from '../../src/index.js';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'assistant-core-smoke-'));
  const dbPath = path.join(tempDir, 'smoke-memory.sqlite');
  const configPath = path.resolve(process.cwd(), 'config', 'assistant-mode-config.example.json');

  assert(fs.existsSync(configPath), `Missing smoke config: ${configPath}`);
  assert(API_VERSION === '1', 'Unexpected API_VERSION (expected "1")');

  const service = new CompanionLLMServiceClass({
    runtime: {
      modeConfigFile: configPath,
      memorySqliteFile: dbPath,
      memoryKey: 'assistant-smoke-memory',
    },
  });

  const mode = service.getMode('smoke-user');
  assert(mode?.mode === 'normal', 'Default mode should be normal');

  const training = service.addTrainingExample('smoke-user', {
    mode: 'normal',
    source: 'smoke',
    accepted: true,
    user: 'Bitte plane meinen Tag in drei Schritten.',
    assistant: 'Klar: 1) Priorität festlegen 2) Zeitblöcke setzen 3) Nächsten Schritt starten.',
  });
  assert(training?.stored === true, 'Training example was not stored');

  const memory = service.loadMemory();
  assert(memory?.users?.['smoke-user'], 'Expected smoke-user to exist in memory');

  const serviceFactoryInstance = createCompanionLLMService({
    runtime: {
      modeConfigFile: configPath,
      memorySqliteFile: path.join(tempDir, 'factory-memory.sqlite'),
      memoryKey: 'assistant-factory-memory',
    },
  });
  assert(typeof serviceFactoryInstance.getMode === 'function', 'Factory service missing getMode()');

  const router = createAssistantRouter({
    CompanionLLMService: service,
    AlpacaService: {
      getAccount: async () => null,
      getOrders: async () => [],
      getPositions: async () => [],
    },
    getAlpacaStatus: async () => ({ status: 'disabled', connected: false }),
    formatUsd: (value) => value,
    sendErrorResponse: (res, statusCode, message, requestId) => res.status(statusCode).json({ ok: false, requestId, error: { message } }),
  });

  assert(typeof router === 'function', 'Router factory did not return an Express router');

  const loraGateway = new LoraTrainingGateway({
    runtime: service.getRuntimeConfig(),
  });
  const loraConfig = loraGateway.getPublicConfig();
  assert(typeof loraConfig === 'object' && loraConfig, 'LoRA gateway config unavailable');

  console.log(JSON.stringify({
    ok: true,
    apiVersion: API_VERSION,
    checks: ['public-imports', 'service-instantiation', 'training-write', 'router-factory', 'lora-gateway'],
    tempDir,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
