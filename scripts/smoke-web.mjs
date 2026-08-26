/**
 * Fetch every route from a real production server and check what came back.
 *
 * `next build` compiles the pages; it does not run them. Every page in this app is
 * `force-dynamic` and reads the rule packs off disk at request time, so the failure that
 * matters most — a deployment whose regulatory content did not ship, or whose working
 * directory is not where the code assumed — produces a green build and a broken site. That
 * has already happened twice on this repository.
 *
 * So this asserts on rendered content, not just on a status code. A 200 carrying an error
 * boundary is still a broken page; a 200 carrying "$4,830,000.00" means the bytes were parsed,
 * mapped, sealed, evaluated and formatted on the way to the browser.
 *
 * Usage: pnpm smoke:web    (run after `pnpm build`)
 */

import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const PORT = Number(process.env.SMOKE_PORT ?? 3210);
const BASE = `http://127.0.0.1:${PORT}`;

/** Strings that can only be present if the whole path ran, not just the framework. */
const ROUTES = [
  {
    path: '/',
    status: 200,
    contains: [
      'Northfield Consolidated School District',
      'US-FED-IDEA-B-2026',
      // The reconciliation balanced, so the import really parsed the fixture.
      'Rows accepted',
      // Both fact origins reached the snapshot.
      'PLATFORM_DETERMINATION',
      // The run is advisory and the page says so.
      'Not a determination',
    ],
  },
  {
    path: '/finding/IDEA-MOE-COMPLIANCE-001',
    status: 200,
    contains: [
      'maintenance of effort',
      // Computed from the CSV, formatted by the engine's own formatter.
      '$4,830,000.00',
      '$125,000.00',
      // Provenance walked back to the file and the cell.
      'northfield-fiscal-fy2026.csv',
      'Comparison Local Actual',
      '34 CFR 300.203(b)',
    ],
  },
  {
    path: '/finding/IDEA-MOE-ELIGIBILITY-001',
    status: 200,
    // Invariant 9 on screen: the missing determination is named rather than assumed.
    contains: ['most_recent_available_year_moe_status', 'Not determined'],
  },
  {
    path: '/finding/IDEA-EXCESS-COST-001',
    status: 200,
    contains: ['idea_excess_cost_v1', 'gap in the platform'],
  },
  { path: '/rules', status: 200, contains: ['Rule library', 'IDEA-MOE-COMPLIANCE-001'] },
  { path: '/finding/NOT-A-RULE', status: 404, contains: ['No such page'] },
];

/**
 * Security headers the app declares.
 *
 * Declared and never checked is how they came to be silently absent once already, when they
 * lived in a `vercel.json` the deployment did not read.
 */
const REQUIRED_HEADERS = [
  'content-security-policy',
  'strict-transport-security',
  'x-content-type-options',
  'x-frame-options',
  'referrer-policy',
  'permissions-policy',
];

const failures = [];
/** Set on any 5xx, so the server's own log — where the stack is — is printed once at the end. */
let serverErrored = false;

/**
 * `detached` so the server gets its own process group.
 *
 * `next start` forks a worker. Signalling only the parent leaves that worker holding the port
 * and this process's inherited pipes, and the script then hangs until CI kills the job — a
 * smoke test that never finishes is worse than none. Killing the group takes both down.
 */
const server = spawn('next', ['start', '-p', String(PORT)], {
  cwd: new URL('../apps/web/', import.meta.url),
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: true,
  env: {
    ...process.env,
    // Node's fetch would otherwise be told to reach 127.0.0.1 through an outbound proxy.
    NO_PROXY: '*',
    no_proxy: '*',
  },
});

function stopServer() {
  if (server.pid === undefined || server.exitCode !== null) return;
  try {
    process.kill(-server.pid, 'SIGTERM');
  } catch {
    // Already gone. Nothing to do, and failing here would mask the real result.
  }
}

let serverOutput = '';
server.stdout.on('data', (chunk) => (serverOutput += chunk));
server.stderr.on('data', (chunk) => (serverOutput += chunk));

async function waitForReady() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`server exited early:\n${serverOutput}`);
    try {
      await fetch(BASE, { signal: AbortSignal.timeout(2000) });
      return;
    } catch {
      await delay(250);
    }
  }
  throw new Error(`server never became ready on ${BASE}:\n${serverOutput}`);
}

try {
  await waitForReady();

  for (const route of ROUTES) {
    const routeResponse = await fetch(BASE + route.path);
    const routeBody = await routeResponse.text();

    if (routeResponse.status !== route.status) {
      failures.push(`${route.path}: expected ${route.status}, got ${routeResponse.status}`);
      if (routeResponse.status >= 500) serverErrored = true;
      continue;
    }

    for (const needle of route.contains) {
      if (!routeBody.includes(needle)) {
        failures.push(`${route.path}: missing ${JSON.stringify(needle)}`);
      }
    }
  }

  const response = await fetch(BASE);
  const body = await response.text();
  for (const header of REQUIRED_HEADERS) {
    if (response.headers.get(header) === null) failures.push(`/: missing ${header} header`);
  }

  /*
   * The nonce, end to end.
   *
   * A CSP header carrying a nonce that the renderer never stamped onto anything is worse than
   * no policy at all: every inline script the App Router emits is blocked, React never
   * hydrates, and the header looks correct to anyone auditing it. So this checks both halves
   * — the policy names a nonce, and the scripts in the document carry that same one.
   */
  const policy = response.headers.get('content-security-policy') ?? '';
  const nonce = /'nonce-([A-Za-z0-9+/=]+)'/.exec(policy)?.[1];
  if (nonce === undefined) {
    failures.push(`/: content-security-policy carries no nonce: ${policy}`);
  } else {
    const inlineScripts = body.match(/<script(?![^>]*\bsrc=)[^>]*>/g) ?? [];
    if (inlineScripts.length === 0) {
      failures.push('/: no inline scripts found, so the nonce check proved nothing');
    }
    const unnonced = inlineScripts.filter((tag) => !tag.includes(nonce));
    if (unnonced.length > 0) {
      failures.push(
        `/: ${unnonced.length} of ${inlineScripts.length} inline scripts lack the CSP nonce ` +
          `— the first is ${unnonced[0]}`,
      );
    }
  }
} finally {
  stopServer();
}

if (failures.length > 0) {
  console.error(`Web smoke test failed:\n${failures.map((line) => `  - ${line}`).join('\n')}`);
  if (serverErrored) {
    // Next's 500 page is a wall of hydration markup and carries only an error digest, so the
    // body is not worth printing. Its own log sometimes is, and when it is silent the fastest
    // route to the stack is the same server run in the foreground.
    if (serverOutput.trim().length > 0)
      console.error(`\nServer log:\n${serverOutput.slice(-4000)}`);
    console.error(
      `\nFor the stack: cd apps/web && npx next start -p ${PORT}, then request the failing path.`,
    );
  }
  process.exit(1);
}

console.log(
  `Web smoke test passed: ${ROUTES.length} routes, ${REQUIRED_HEADERS.length} headers, ` +
    'CSP nonce stamped on every inline script.',
);
// Explicit, because the server's stdio pipes can outlive it and keep the loop alive.
process.exit(0);
