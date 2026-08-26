import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Where the rule packs live on the running server's disk.
 *
 * The packs are regulatory content read at request time, not modules, so their path has to be
 * resolved rather than imported. That path depends on the process's working directory, and
 * this repository deploys under two different Vercel root directories — the repository root
 * and `apps/web` — which put the working directory in two different places. A build succeeds
 * under both; only a request reveals the difference, because `loadRulePack` is what fails.
 *
 * So the root is found by looking for it. Probing two candidates is cheap, is done once per
 * process, and turns a silent runtime failure on one of the two deployments into a
 * configuration that simply works on both.
 */
function findRepoRoot(): string {
  const cwd = process.cwd();
  const candidates = [cwd, path.join(cwd, '..', '..')];
  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, 'rulepacks'))) return candidate;
  }
  throw new Error(
    `No rulepacks directory found from ${cwd}. Looked in: ${candidates.join(', ')}. ` +
      'The deployment is missing the regulatory content it is supposed to serve; see ' +
      'outputFileTracingIncludes in next.config.ts.',
  );
}

const ROOT = findRepoRoot();

export const PACK_DIR = path.join(ROOT, 'rulepacks/federal/idea-b/us-fed-idea-b-2026');
export const SOURCES_DIR = path.join(ROOT, 'rulepacks/sources');
