-- Indexes for the read API (SPEC §11.3). The logs endpoint orders by
-- (checked_at, service_id, agent) and pages with a keyset on that same tuple,
-- so the index has to match the ordering exactly or every page sorts the
-- whole upload.
create index checks_upload_keyset
  on checks (upload_id, checked_at, service_id, agent);

-- The logs filter bar offers "agent", which without this scans the upload.
create index checks_upload_agent
  on checks (upload_id, agent);

-- outcome=failures is the most common filter and selects a small fraction of
-- rows, so a partial index keeps it cheap.
create index checks_upload_down
  on checks (upload_id, checked_at)
  where status_code not between 200 and 399;
