-- Per-company booking page branding (colors + self-hosted fonts) as JSON. Empty = Nudge default.
-- Shape: {"v":1,"colors":{accent,accentDark,accentLight,ink,inkSoft,muted,bg,paper,line},"fonts":{"heading","body"}}
ALTER TABLE invoice_settings ADD COLUMN brand_json TEXT NOT NULL DEFAULT '';
