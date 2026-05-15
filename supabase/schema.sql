-- Run this in Supabase SQL Editor

create table if not exists entries (
  id uuid default gen_random_uuid() primary key,
  created_at timestamptz default now(),
  name text not null,
  odds text not null,
  stake numeric not null,
  payout numeric not null,
  description text not null,
  image_url text,
  date date default current_date
);

-- Index for fast daily queries
create index if not exists entries_date_idx on entries(date);

-- Enable Row Level Security
alter table entries enable row level security;

-- Allow anyone to read entries
create policy "Anyone can read entries"
  on entries for select
  using (true);

-- Allow anyone to insert entries
create policy "Anyone can insert entries"
  on entries for insert
  with check (true);

-- Storage bucket for bet slip images
insert into storage.buckets (id, name, public)
values ('bet-slips', 'bet-slips', true)
on conflict do nothing;

-- Allow anyone to upload images
create policy "Anyone can upload bet slips"
  on storage.objects for insert
  with check (bucket_id = 'bet-slips');

-- Allow anyone to read bet slip images
create policy "Anyone can read bet slips"
  on storage.objects for select
  using (bucket_id = 'bet-slips');
