-- ProofHire schema. Row level security stays off for the hackathon.
-- The service role key is only used server side.
-- JSON columns hold the contract types as they are.

create table jobs (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null,
  persona_expectations jsonb not null,
  created_at timestamptz default now()
);

create table candidates (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references jobs(id) on delete cascade,
  name text not null,
  github_username text not null,
  resume_text text not null,
  status text not null default 'new',
  created_at timestamptz default now()
);

create table repo_reports (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid references candidates(id) on delete cascade,
  repo_url text not null,
  report jsonb not null,
  created_at timestamptz default now(),
  unique (candidate_id, repo_url)
);

create table candidate_scores (
  candidate_id uuid primary key references candidates(id) on delete cascade,
  relevance int not null,
  authenticity int not null,
  fit int not null,
  rank int,
  summary text,
  projects jsonb,
  updated_at timestamptz default now()
);

create table panel_reports (
  candidate_id uuid primary key references candidates(id) on delete cascade,
  panel_score int not null,
  recommendation text not null,
  report jsonb not null,
  completed_at timestamptz default now()
);

create table panel_events (
  id bigserial primary key,
  candidate_id uuid references candidates(id) on delete cascade,
  seq int not null,
  kind text not null,
  persona text,
  payload jsonb,
  created_at timestamptz default now()
);

create index on panel_events (candidate_id, seq);
create unique index if not exists panel_events_candidate_seq on panel_events (candidate_id, seq);

alter publication supabase_realtime add table candidates, candidate_scores, panel_reports, panel_events;

-- candidates.status moves through new, screening, screened, panel_running, panel_done.
