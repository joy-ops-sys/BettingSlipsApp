-- Run once in Supabase → SQL Editor
-- 1. Lets the app flag slips where the player had to type in a number the AI couldn't read
alter table entries add column if not exists manual_fields text;

-- 2. All writes now go through the app's server (which checks the slip), so nobody
--    should be able to insert rows directly with the public key
drop policy if exists "Anyone can insert entries" on entries;
