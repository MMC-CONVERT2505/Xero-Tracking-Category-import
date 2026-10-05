// Regression test for a real bug: xeroAuthService.js used to cache
// process.env.XERO_CLIENT_ID into a module-level const at require-time,
// and app.js's require chain loaded that module BEFORE config/constants.js
// (the only place dotenv.config() was called) ever ran - so a value that
// was genuinely present in .env still came out undefined.
//
// This must run in a FRESH child process with .env as the ONLY source of
// the credentials (never pre-set in process.env) - that's the one thing
// every earlier smoke test failed to do, which is exactly how this bug
// shipped unnoticed. No stubbing here: this boots the real server.js.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = 4099;
const envPath = path.join(__dirname, '..', '.env');
const envBackup = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : null;

const testEnvContent = [
  'XERO_CLIENT_ID=test-client-id-from-dotenv-file',
  'XERO_CLIENT_SECRET=test-secret-from-dotenv-file',
  `PORT=${PORT}`,
  'FRONTEND_URL=http://localhost:5005',
].join('\n');

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  fs.writeFileSync(envPath, testEnvContent, 'utf8');

  // Spawn with a CLEAN env (no XERO_* vars inherited from this shell) so
  // the ONLY way the child process can see the credentials is by actually
  // reading backend/.env itself - exactly the real npm start scenario.
  const cleanEnv = { ...process.env };
  delete cleanEnv.XERO_CLIENT_ID;
  delete cleanEnv.XERO_CLIENT_SECRET;

  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: path.join(__dirname, '..'),
    env: cleanEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });

  try {
    await sleep(1200); // let it boot

    const res = await fetch(`http://localhost:${PORT}/auth/xero`, { redirect: 'manual' });
    console.log('/auth/xero status:', res.status, '| Location:', res.headers.get('location'));

    if (res.status !== 302) {
      console.error('--- child process output ---\n' + out);
      throw new Error(`FAIL: expected 302 redirect to Xero, got ${res.status} - dotenv/require-order bug has regressed`);
    }
    if (!res.headers.get('location')?.startsWith('https://login.xero.com/')) {
      throw new Error('FAIL: redirected somewhere other than Xero');
    }
    if (!res.headers.get('location')?.includes('client_id=test-client-id-from-dotenv-file')) {
      throw new Error('FAIL: redirect did not carry the .env-sourced client_id - env var still not loading correctly');
    }
    console.log('ALL ASSERTIONS PASSED - .env loads correctly through the real require chain');
  } finally {
    child.kill('SIGTERM');
    await sleep(200);
    if (envBackup !== null) fs.writeFileSync(envPath, envBackup, 'utf8');
    else fs.unlinkSync(envPath);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
