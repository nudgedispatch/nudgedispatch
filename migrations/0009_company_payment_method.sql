-- Client (company owner) payment method summary. Card details are collected and stored only by Stripe
-- (Stripe Checkout in setup mode / the Stripe billing portal). D1 keeps ONLY brand, last 4, and expiry
-- for display; never the card number, CVC, or the Stripe payment method id.
-- Additive only, all nullable. Apply to prod BEFORE deploying the Worker that reads it.
ALTER TABLE companies ADD COLUMN pm_brand TEXT;
ALTER TABLE companies ADD COLUMN pm_last4 TEXT CHECK (pm_last4 IS NULL OR (length(pm_last4) = 4 AND pm_last4 NOT GLOB '*[^0-9]*'));
ALTER TABLE companies ADD COLUMN pm_exp_month INTEGER;
ALTER TABLE companies ADD COLUMN pm_exp_year INTEGER;
ALTER TABLE companies ADD COLUMN pm_updated_at INTEGER;
