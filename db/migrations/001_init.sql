-- SPEC §10: initial schema.
create extension if not exists pgcrypto;

create table uploads (
  id            uuid primary key default gen_random_uuid(),
  filename      text not null,
  size_bytes    integer not null,
  sha256        char(64) not null,
  total_rows    integer not null,
  chunk_count   integer not null,
  status        text not null default 'processing'
                check (status in ('processing','complete')),
  range_start   timestamptz,
  range_end     timestamptz,
  summary       jsonb,
  created_at    timestamptz not null default now(),
  completed_at  timestamptz
);
-- Only complete uploads take part in the duplicate check, so an abandoned
-- upload never blocks re-processing the same file.
create index uploads_sha_complete on uploads (sha256) where status = 'complete';

create table upload_chunks (
  upload_id            uuid not null references uploads(id) on delete cascade,
  chunk_index          integer not null,
  rows_in              integer not null,
  stored               integer not null,
  merged_in_chunk      integer not null,
  merged_across_chunks integer not null,
  rejected             integer not null,
  issue_counts         jsonb not null default '{}',
  processed_at         timestamptz not null default now(),
  primary key (upload_id, chunk_index)
);

create table services (
  id   text primary key,
  name text not null
);

create table checks (
  upload_id     uuid not null references uploads(id) on delete cascade,
  service_id    text not null references services(id),
  checked_at    timestamptz not null,
  agent         text not null,
  region        text,
  status_code   smallint not null,
  latency_ms    integer,
  ts_format     text not null,
  raw_timestamp text not null,
  source_line   integer not null,
  flags         text[] not null default '{}',
  -- SPEC §7.4: the duplicate key, which is what makes re-processing idempotent.
  primary key (upload_id, service_id, checked_at, agent)
);
create index checks_upload_time on checks (upload_id, checked_at);

create table rejected_rows (
  id          bigserial primary key,
  upload_id   uuid not null references uploads(id) on delete cascade,
  chunk_index integer not null,
  line_number integer not null,
  reason      text not null,
  raw_line    text not null
);
create index rejected_upload on rejected_rows (upload_id, line_number);

-- SPEC §8.2: one row per service per 15-minute slot, worst agent winning.
create view slot_status as
select upload_id,
       service_id,
       checked_at as slot,
       bool_or(status_code not between 200 and 399) as is_down,
       count(*)                                      as agent_reports,
       percentile_cont(0.5) within group (order by latency_ms)
         filter (where latency_ms is not null)       as median_latency_ms
from checks
group by upload_id, service_id, checked_at;
