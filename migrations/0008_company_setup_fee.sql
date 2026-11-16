-- Setup-fee choice per company (Jesse, Nov 16, 2026): only clients flagged as paying are charged setup.
-- free   = Stripe promotion code FREESETUP (100% off, once, setup products only)  <- default
-- charge = full setup fee, no discount
-- beta   = Stripe promotion code BETA50 (50% off plan setup)
-- Used when the admin starts a subscription and again when texting is turned on later (texting setup fee).
-- Additive only. Existing companies get 'free'; the admin can change it per company in the console.
-- Apply to prod BEFORE deploying the Worker that reads it. Do not apply to a remote DB from a checkout by hand.
ALTER TABLE companies ADD COLUMN setup_fee TEXT NOT NULL DEFAULT 'free' CHECK (setup_fee IN ('free', 'charge', 'beta'));
