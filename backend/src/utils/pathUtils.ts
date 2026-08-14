import { isAbsolute, join, relative, sep } from 'node:path';

import { env } from '../config.js';

/**
 * Path construction utilities for consistent file organization
 * Consolidates repeated path patterns across the codebase
 */

/** Thrown when a caller-supplied path segment would escape its base directory. */
export class PathTraversalError extends Error {
  constructor(message = 'Path segment escapes its base directory') {
    super(message);
    this.name = 'PathTraversalError';
  }
}

/**
 * Join `segments` under `base` and refuse any result that lands outside it.
 *
 * Containment is checked against the *resolved* relative path, not by scanning
 * the raw segment for `..`: a filename like `report..final.csv` or `..foo` is
 * legitimate and survives an upload intact, so a `includes('..')` rule would
 * reject real data. What must be refused is a resolved path that steps above
 * the base — `../../etc/passwd` resolving to `/etc/passwd`, or an absolute
 * segment replacing the base entirely. `relative(base, full)` is exactly `..`,
 * or begins `../`, only in that escaping case; a legitimate `..foo` filename
 * comes back as `..foo`, which does neither.
 */
function joinContained(base: string, segments: string[]): string {
  const full = join(base, ...segments);
  const rel = relative(base, full);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new PathTraversalError();
  }
  return full;
}

export function getDatasetPath(datasetId: string, ...segments: string[]): string {
  // The datasetId is UUID-validated at every route; the trailing segments are
  // filenames that originate from user input (upload names, and the rename
  // endpoint's body), so they are the untrusted part and get contained here —
  // the single chokepoint every dataset file access funnels through.
  return joinContained(join(env.datasetStorageDir, datasetId), segments);
}
