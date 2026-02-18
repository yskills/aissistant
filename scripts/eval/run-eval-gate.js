import fs from 'fs';
import path from 'path';
import CompanionLLMService from '../../src/services/CompanionLLMService.js';

const DEFAULT_CONFIG_FILE = path.resolve(process.cwd(), 'config', 'eval', 'gate.config.json');
const REPORT_DIR = path.resolve(process.cwd(), 'reports', 'eval');
const REPORT_FILE = path.join(REPORT_DIR, 'latest.json');

function normalizeText(value = '') {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function includesAny(text = '', terms = []) {
  if (!Array.isArray(terms) || !terms.length) return true;
  const source = normalizeText(text);
  return terms.some((term) => source.includes(normalizeText(term)));
}

function includesForbidden(text = '', terms = []) {
  if (!Array.isArray(terms) || !terms.length) return false;
  const source = normalizeText(text);
  return terms.some((term) => source.includes(normalizeText(term)));
}

function parseArgs() {
  const args = process.argv.slice(2);
  const configArg = args.find((arg) => arg.startsWith('--config='));
  return {
    configFile: configArg ? path.resolve(process.cwd(), configArg.split('=')[1]) : DEFAULT_CONFIG_FILE,
  };
}

function readConfig(configFile) {
  if (!fs.existsSync(configFile)) {
    throw new Error(`Missing eval config file: ${configFile}`);
  }
  return JSON.parse(fs.readFileSync(configFile, 'utf8'));
}

async function runCase(testCase) {
  const userId = `eval-${testCase.characterId || 'default'}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const snapshot = {
    account: { equity: '$10000', cash: '$3000', buyingPower: '$6000' },
    orders: { open: 2 },
    positions: { count: 1 },
  };

  let reply = '';
  let error = null;

  try {
    const result = await CompanionLLMService.chat({
      message: String(testCase.message || ''),
      snapshot,
      userId,
      mode: String(testCase.mode || 'normal'),
    });
    reply = String(result?.reply || '');
  } catch (err) {
    error = String(err?.message || err);
  } finally {
    try {
      CompanionLLMService.resetUserState(userId);
    } catch {
      // ignore reset failures in eval cleanup
    }
  }

  const checks = testCase.checks || {};
  const mustIncludePass = includesAny(reply, checks.mustIncludeAny || []);
  const mustNotIncludePass = !includesForbidden(reply, checks.mustNotIncludeAny || []);
  const maxCharsPass = Number.isFinite(Number(checks.maxChars))
    ? reply.length <= Number(checks.maxChars)
    : true;

  const passed = !error && mustIncludePass && mustNotIncludePass && maxCharsPass;

  return {
    id: testCase.id,
    passed,
    error,
    checks: {
      mustIncludePass,
      mustNotIncludePass,
      maxCharsPass,
    },
    reply,
    replyLength: reply.length,
  };
}

async function runSuite(suite) {
  const cases = Array.isArray(suite?.cases) ? suite.cases : [];
  const caseResults = [];

  for (const testCase of cases) {
    // eslint-disable-next-line no-await-in-loop
    const result = await runCase(testCase);
    caseResults.push(result);
  }

  const passedCases = caseResults.filter((item) => item.passed).length;
  const passRate = cases.length ? passedCases / cases.length : 0;

  return {
    id: suite.id,
    description: suite.description || '',
    weight: Number(suite.weight || 1),
    minPassRate: Number(suite.minPassRate || 0),
    casesTotal: cases.length,
    casesPassed: passedCases,
    passRate,
    passed: passRate >= Number(suite.minPassRate || 0),
    caseResults,
  };
}

async function main() {
  const { configFile } = parseArgs();
  const config = readConfig(configFile);
  const suites = Array.isArray(config?.suites) ? config.suites : [];

  const suiteResults = [];
  for (const suite of suites) {
    // eslint-disable-next-line no-await-in-loop
    const suiteResult = await runSuite(suite);
    suiteResults.push(suiteResult);
  }

  const weightSum = suiteResults.reduce((sum, item) => sum + Math.max(0, Number(item.weight || 0)), 0) || 1;
  const weightedPassRate = suiteResults
    .reduce((sum, item) => sum + (item.passRate * Math.max(0, Number(item.weight || 0))), 0) / weightSum;

  const suitesPassed = suiteResults.every((suite) => suite.passed);
  const minOverallPassRate = Number(config?.minOverallPassRate || 0);
  const overallPassed = suitesPassed && weightedPassRate >= minOverallPassRate;

  const report = {
    generatedAt: new Date().toISOString(),
    configFile,
    minOverallPassRate,
    weightedPassRate,
    suitesPassed,
    overallPassed,
    suiteResults,
  };

  if (!fs.existsSync(REPORT_DIR)) {
    fs.mkdirSync(REPORT_DIR, { recursive: true });
  }

  fs.writeFileSync(REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(report, null, 2));

  if (!overallPassed) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
