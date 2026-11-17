-- Terms of Service + Privacy Policy consent per user (Jesse, Nov 17, 2026).
-- Every self-created account (public signup, owner setup link, driver setup link) must tick
-- "I agree to the Terms of Service and Privacy Policy"; the server records when and which terms version.
-- Additive only. Existing users keep NULL / ''. Apply to prod BEFORE deploying the Worker that writes these columns.
ALTER TABLE users ADD COLUMN terms_accepted_at INTEGER;
ALTER TABLE users ADD COLUMN terms_version TEXT NOT NULL DEFAULT '';
