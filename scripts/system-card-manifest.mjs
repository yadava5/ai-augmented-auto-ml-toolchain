import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// Shared by scripts/copy-system-card.mjs (writes the manifest) and
// scripts/check-system-card.mjs (verifies it). See check-system-card.mjs for
// what the manifest is for.
export const repoRoot = fileURLToPath(new URL('../', import.meta.url));
export const artifactDir = 'landing/public/system-card';
export const manifestPath = path.join(repoRoot, 'scripts/system-card.manifest.json');

// Everything the booklet build reads. booklet/src/content.ts re-exports from
// ../../poster/src/content and booklet/src/theme.ts from ../../poster/src/tokens,
// so the poster's sources are inputs here too: leave them out and an edit to
// the shared copy would change the bundle with this gate still green. The
// lockfile is included because a dependency bump changes the emitted bytes
// without touching a single source file.
const sourceRoots = [
  'booklet/index.html',
  'booklet/package.json',
  'booklet/package-lock.json',
  'booklet/tsconfig.json',
  'booklet/vite.config.ts',
  'booklet/src',
  'booklet/public',
  'poster/src',
];

const sha256 = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

const walk = (absolute, relative, into) => {
  if (fs.statSync(absolute).isFile()) {
    into[relative] = sha256(absolute);
    return;
  }
  for (const name of fs.readdirSync(absolute).sort()) {
    walk(path.join(absolute, name), `${relative}/${name}`, into);
  }
};

/** sha256 of every file the booklet build reads, keyed by repo-relative path. */
export const hashSources = () => {
  const hashes = {};
  for (const root of sourceRoots) {
    const absolute = path.join(repoRoot, root);
    // Hard failure, not a skip: a silently-absent input is a gate that cannot fail.
    if (!fs.existsSync(absolute)) {
      throw new Error(`system-card manifest input is missing: ${root}`);
    }
    walk(absolute, root, hashes);
  }
  return hashes;
};

/** sha256 of every committed artifact file. Empty when the directory is gone. */
export const hashArtifact = () => {
  const hashes = {};
  const absolute = path.join(repoRoot, artifactDir);
  if (fs.existsSync(absolute)) walk(absolute, artifactDir, hashes);
  return hashes;
};
