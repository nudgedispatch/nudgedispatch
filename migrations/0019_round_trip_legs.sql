-- 0019 (Nov 24, 2026): different-date round trips become two linked rides.
-- Additive only. Same-day (or missing return time) stays one rides row and keeps
-- return_date / return_time. Split legs share group_id, use leg 1 then 2, and leave
-- return_date / return_time empty — the return's pickup_date / pickup_time is the
-- return. Invoices and payments stay per ride.
--
-- ride_requests is unused by the app today (public booking writes rides with
-- approval='requested'). return_ride_id is added so a future request row can point
-- at both legs (ride_id + return_ride_id). The live link between legs is rides.group_id.
ALTER TABLE rides ADD COLUMN return_date TEXT NOT NULL DEFAULT '';
ALTER TABLE rides ADD COLUMN return_time TEXT NOT NULL DEFAULT '';
ALTER TABLE rides ADD COLUMN group_id TEXT NOT NULL DEFAULT '';
ALTER TABLE rides ADD COLUMN leg INTEGER;
CREATE INDEX IF NOT EXISTS rides_company_group ON rides(company_id, group_id);

ALTER TABLE ride_requests ADD COLUMN return_ride_id TEXT;
