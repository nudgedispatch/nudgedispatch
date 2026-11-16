-- Structured "Pay with" options on invoices: Cash, Cash App, Zelle, Venmo, PayPal.
-- Additive only. Do not apply this file to a remote database from this checkout.
-- payment_methods_json: { cash|cashapp|zelle|venmo|paypal: { on, handle } }, see app/payment-methods.js.
-- Existing rows get '{}' (nothing turned on), so current invoices keep using payment_instructions.

ALTER TABLE invoice_settings ADD COLUMN payment_methods_json TEXT NOT NULL DEFAULT '{}';
