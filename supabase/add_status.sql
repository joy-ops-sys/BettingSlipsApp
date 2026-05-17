-- Run this in Supabase SQL Editor
-- Adds bet_status column to existing entries table

alter table entries 
add column if not exists bet_status text not null default 'won';

-- Update any existing entries to 'won'
update entries set bet_status = 'won' where bet_status is null;
