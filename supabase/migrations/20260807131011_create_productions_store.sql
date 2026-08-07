create table public.productions (
  id text primary key check (id ~ '^[A-Za-z0-9_-]+$'),
  title text not null check (length(btrim(title)) > 0),
  production_date date not null,
  revision integer not null check (revision >= 0),
  document jsonb not null check (jsonb_typeof(document) = 'object'),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint production_document_identity_check check (document ->> 'id' = id),
  constraint production_document_revision_check check ((document ->> 'revision')::integer = revision),
  constraint production_document_title_check check (document ->> 'title' = title),
  constraint production_document_date_check check ((document ->> 'productionDate')::date = production_date)
);

create index productions_date_title_idx
  on public.productions (production_date, title);

alter table public.productions enable row level security;

revoke all on table public.productions from anon, authenticated;
grant select, insert, update on table public.productions to service_role;
