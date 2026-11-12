-- Arrived step between En route and Picked up. Wait time is arrived_at to picked_up_at.
-- Additive only. Do not apply this file to a remote database from this checkout.
-- Existing rides keep their progress values; arrived_at stays null until the new step is used.

ALTER TABLE rides ADD COLUMN arrived_at INTEGER;
