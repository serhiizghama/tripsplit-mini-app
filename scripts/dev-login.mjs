/**
 * Local-dev helper: generates a signed Telegram `initData` string and writes
 * it into `web/.env.local` as `VITE_DEV_INIT_DATA`, so `npm run dev` works in
 * a plain desktop browser without a real Telegram client.
 *
 * How it works: the API server validates every `/api/*` request's initData
 * signature with `BOT_TOKEN` (server/.env). This script signs a fake demo
 * user with that SAME token, so the server accepts it. The signature carries
 * an `auth_date` and the server rejects anything older than 1 hour — so just
 * re-run this script (and reload the browser) whenever requests start 401ing.
 *
 * Usage (from the repo root):
 *   node scripts/dev-login.mjs                       # default demo user
 *   node scripts/dev-login.mjs --id 222 --name Alex  # a second user
 *
 * This is a LOCAL DEV CONVENIENCE ONLY. It is never used by production builds
 * (web/src/telegram/launchData.ts gates VITE_DEV_INIT_DATA behind
 * import.meta.env.DEV, which Vite strips from the prod bundle).
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sign } from '@tma.js/init-data-node';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const serverEnvPath = join(repoRoot, 'server', '.env');
const webEnvPath = join(repoRoot, 'web', '.env.local');

// --- read BOT_TOKEN from server/.env -----------------------------------
function readEnv(path, key) {
  if (!existsSync(path)) return undefined;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && m[1] === key) return m[2].replace(/^["']|["']$/g, '');
  }
  return undefined;
}

const botToken = readEnv(serverEnvPath, 'BOT_TOKEN');
if (!botToken) {
  console.error(`✗ BOT_TOKEN not found in ${serverEnvPath}. Create server/.env first.`);
  process.exit(1);
}

// --- parse args --------------------------------------------------------
const args = process.argv.slice(2);
const getArg = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};
const id = Number(getArg('--id', '111111111'));
const firstName = getArg('--name', 'Serhii');

// --- sign initData -----------------------------------------------------
const initData = sign(
  {
    user: {
      id,
      first_name: firstName,
      username: `demo_${id}`,
      language_code: 'ru',
    },
    chat_type: 'private',
  },
  botToken,
  new Date(),
);

// --- write web/.env.local (preserving other keys) ----------------------
let lines = existsSync(webEnvPath)
  ? readFileSync(webEnvPath, 'utf8').split('\n')
  : ['VITE_API_BASE=/api'];
const keyLine = `VITE_DEV_INIT_DATA=${initData}`;
const idx = lines.findIndex((l) => l.startsWith('VITE_DEV_INIT_DATA='));
if (idx !== -1) lines[idx] = keyLine;
else lines.push(keyLine);
writeFileSync(webEnvPath, lines.filter((l) => l.length > 0).join('\n') + '\n');

console.log(`✓ Wrote VITE_DEV_INIT_DATA to ${webEnvPath}`);
console.log(`  user: id=${id} first_name="${firstName}"  (valid ~1h)`);
console.log(`  If dev is already running, restart it (or reload) to pick up the new value.`);
