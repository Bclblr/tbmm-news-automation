create table if not exists public.tbmm_news (
  id uuid primary key default gen_random_uuid(),
  source_id text not null,
  title text not null,
  summary text not null default '',
  content text not null default '',
  source_url text not null unique,
  category text not null,
  published_at timestamptz,
  image_url text,
  content_hash text not null unique,
  status text not null default 'new' check (status in ('new', 'ready', 'published', 'failed')),
  generated_title text,
  generated_text text,
  generated_image_url text,
  published_to_instagram boolean not null default false,
  published_to_facebook boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tbmm_news_published_at_idx on public.tbmm_news (published_at desc);
create index if not exists tbmm_news_status_idx on public.tbmm_news (status);

alter table public.tbmm_news enable row level security;