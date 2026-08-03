-- Migration 020: Backfill existing users as email-verified
-- Users who registered before the email verification flow was added
-- should not be forced through verification retroactively.
--
-- GUARDED, and the guard is the point.
--
-- This was an unconditional `UPDATE users SET email_verified = true WHERE
-- email_verified = false`. backend/src/scripts/runMigrations.ts has no version
-- table: it readdirSync().sort()s this directory and executes EVERY file on
-- EVERY run. So any later `npm run db:migrate` marked every pending signup as
-- verified — turning a routine maintenance command into a silent bypass of the
-- email verification that requireAuth({ requireVerified: true }) relies on.
--
-- The guard is self-limiting rather than a hard-coded date. The backfill is
-- only meaningful while no verification has ever been issued; 019 creates
-- email_verification_tokens and the auth routes mark tokens `used` rather than
-- deleting them, so once the flow has run even once this table is permanently
-- non-empty and the statement below is a no-op forever after.
--
-- On a fresh database the table is empty but so is `users`, so this is still a
-- no-op. On the first apply to a pre-flow database it does exactly what it
-- originally did.
UPDATE users
SET email_verified = true
WHERE email_verified = false
  AND NOT EXISTS (SELECT 1 FROM email_verification_tokens);
