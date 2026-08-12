/**
 * The public home of the source. This is GitHub, not the Miami GitLab: the
 * GitLab instance is behind university SSO, so every visitor who followed the
 * footer link or /repo from outside Miami hit a login wall instead of the code.
 * GitHub carries the same history — the full 2,125-commit tree was mirrored
 * there — so nothing is lost by pointing the public at it.
 */
export const REPO_URL = 'https://github.com/yadava5/ai-augmented-auto-ml-toolchain';

/**
 * @deprecated Retained for one commit so each consumer can migrate on its own
 * and every intermediate commit still builds. Removed once Footer.astro,
 * repo.astro and the preview tests are on REPO_URL.
 */
export const GITLAB_REPO_URL = REPO_URL;
