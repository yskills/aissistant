import fs from 'fs';
import path from 'path';
import express from 'express';
import createAssistantServiceApp from './service/createAssistantServiceApp.js';
import { resolveRuntimeConfig } from './config/runtimeConfig.js';

const runtime = resolveRuntimeConfig();
const PORT = Math.max(1, Number(process.env.PORT || 5050));
const HOST = process.env.HOST || '127.0.0.1';
const webDir = path.resolve(runtime.rootDir, 'web');

const app = createAssistantServiceApp({
  mountPath: '/assistant',
  enableCors: true,
});

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: '@luna/assistant-core',
    timestamp: new Date().toISOString(),
  });
});

if (fs.existsSync(webDir)) {
  app.use('/', express.static(webDir));
  app.get('/', (_req, res) => {
    res.sendFile(path.join(webDir, 'index.html'));
  });
}

function startServer(port, retriesLeft = 4) {
  const server = app.listen(port, HOST, () => {
    const url = `http://${HOST}:${port}`;
    console.log(`Assistant Dev UI läuft auf ${url}`);
    console.log(`API Basis: ${url}/assistant`);
  });

  server.on('error', (error) => {
    if (error?.code === 'EADDRINUSE' && retriesLeft > 0) {
      const nextPort = port + 1;
      console.warn(`Port ${port} ist belegt, versuche ${nextPort}...`);
      startServer(nextPort, retriesLeft - 1);
      return;
    }
    throw error;
  });
}

startServer(PORT);
