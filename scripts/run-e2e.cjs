const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const build = spawnSync(npmCommand, ['run', 'build'], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

if (build.status !== 0) process.exit(build.status ?? 1);

const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stageflow-e2e-'));
const testPort = process.env.E2E_PORT || '4179';

const server = spawn(process.execPath, ['server.js'], {
  cwd: root,
  env: { ...process.env, PORT: testPort, PRODUCTION_DATA_DIR: testDataDir },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});

server.stdout.pipe(process.stdout);
server.stderr.pipe(process.stderr);

async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Server exited with code ${server.exitCode}.`);
    try {
      const response = await fetch(`http://127.0.0.1:${testPort}/api/health`);
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Server did not become ready in 10 seconds.');
}

async function run() {
  try {
    await waitForServer();
    const playwrightCli = require.resolve('@playwright/test/cli');
    const test = spawn(process.execPath, [playwrightCli, 'test', ...process.argv.slice(2)], {
      cwd: root,
      env: { ...process.env, BASE_URL: `http://127.0.0.1:${testPort}` },
      stdio: 'inherit',
      windowsHide: true,
    });
    const exitCode = await new Promise((resolve) => test.on('exit', (code) => resolve(code ?? 1)));
    process.exitCode = exitCode;
  } finally {
    server.kill();
    fs.rmSync(testDataDir, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
  server.kill();
  fs.rmSync(testDataDir, { recursive: true, force: true });
});
