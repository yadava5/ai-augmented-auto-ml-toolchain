import fs from 'node:fs';
import { hashArtifact, hashSources, manifestPath } from './system-card-manifest.mjs';

/**
 * Fails when the committed build at landing/public/system-card/ no longer
 * corresponds to the booklet sources it was built from.
 *
 * That artifact is a build output kept in the repo so no deploy can drop the
 * page again, which buys a matching hazard: edit booklet/src, forget to
 * rebuild, and the live system card serves stale content while build:landing,
 * test:landing and lint all stay green.
 *
 * This compares recorded sha256 hashes rather than rebuilding. Rebuilding
 * would be the stronger check, but it cannot be made deterministic here: this
 * repo installs with `npm install`, not `npm ci` (the lockfiles are knowingly
 * out of sync -- see .github/workflows/ci.yml), so CI can resolve a newer vite
 * or esbuild than the machine that produced the artifact and emit different
 * minified bytes. That gate would go red for reasons unrelated to the defect,
 * and a gate that cries wolf gets deleted. Hashes are exact, need no install
 * and no build, and run in milliseconds.
 *
 * What this proves: sources and artifact are both byte-for-byte what they were
 * when `npm run booklet:system-card` last wrote the manifest -- so the artifact
 * was built from these sources. Either side drifting turns it red.
 */

const fix = 'Fix: run `npm run booklet:system-card` and commit the result.';

if (!fs.existsSync(manifestPath)) {
  console.error(`Missing ${manifestPath}.\n${fix}`);
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
const expected = { sources: manifest.sources ?? {}, artifact: manifest.artifact ?? {} };
const actual = { sources: hashSources(), artifact: hashArtifact() };

const diff = (before, after) => ({
  added: Object.keys(after).filter((key) => !(key in before)).sort(),
  removed: Object.keys(before).filter((key) => !(key in after)).sort(),
  changed: Object.keys(after)
    .filter((key) => key in before && before[key] !== after[key])
    .sort(),
});

let failed = false;
for (const side of ['sources', 'artifact']) {
  const { added, removed, changed } = diff(expected[side], actual[side]);
  if (!added.length && !removed.length && !changed.length) continue;
  failed = true;
  const label = side === 'sources' ? 'booklet sources' : 'committed system card';
  console.error(`\n${label} drifted from scripts/system-card.manifest.json:`);
  for (const [heading, list] of [
    ['changed', changed],
    ['added', added],
    ['removed', removed],
  ]) {
    if (!list.length) continue;
    console.error(`  ${heading} (${list.length}):`);
    for (const key of list.slice(0, 12)) console.error(`    ${key}`);
    if (list.length > 12) console.error(`    ... and ${list.length - 12} more`);
  }
}

if (failed) {
  console.error(
    `\nlanding/public/system-card/ is a committed build output, so the live page` +
      ` at /system-card is now stale.\n${fix}`,
  );
  process.exit(1);
}

const counts = `${Object.keys(actual.sources).length} sources, ${Object.keys(actual.artifact).length} artifact files`;
console.log(`Committed system card is current (${counts}).`);
