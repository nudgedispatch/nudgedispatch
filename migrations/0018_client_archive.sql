-- 0018 (Nov 20, 2026): owner "Delete client" with archive for clients that have history.
-- Additive only. NULL = not archived; otherwise ms epoch when the owner archived the client.
-- Archived clients keep their rides, invoices and schedules; the app hides them from the client
-- list and the new-ride picker unless "Archived" is chosen. The Worker tolerates this column being
-- missing (list/get work, hard delete works, archive/restore answer 409 "database update needed").
ALTER TABLE clients ADD COLUMN archived_at INTEGER;
CREATE INDEX IF NOT EXISTS clients_company_archived ON clients(company_id, archived_at);
