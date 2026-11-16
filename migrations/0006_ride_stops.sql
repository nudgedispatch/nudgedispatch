-- Intermediate stops between pickup and drop-off, from the booking page or the owner's ride form.
-- Additive only. Do not apply this file to a remote database from this checkout.
-- stops_json: JSON array of up to 5 address strings in trip order (see app/stops.js). NULL means no
-- stops, so every existing ride keeps its current behavior. Booking-page requests are rides rows
-- with approval = 'requested', so this one column covers requests and rides. (The legacy
-- ride_requests table is not read or written by the app.)

ALTER TABLE rides ADD COLUMN stops_json TEXT;
