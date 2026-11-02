-- India time for the database. Timestamps are always stored as exact instants (timestamptz), so nothing stored changes; what changes is how the database
-- READS the clock: "default current_date" and any date taken from now() were the UTC date, which is yesterday's date between 12:00 AM and 5:30 AM IST.
-- Safe to run more than once. New connections pick it up; the change does not touch existing rows.
alter database postgres set timezone to 'Asia/Kolkata';
alter role authenticator set timezone to 'Asia/Kolkata';
alter role authenticated set timezone to 'Asia/Kolkata';
alter role anon set timezone to 'Asia/Kolkata';
alter role service_role set timezone to 'Asia/Kolkata';
-- check afterwards:  show timezone;   (in a new session it says Asia/Kolkata)
