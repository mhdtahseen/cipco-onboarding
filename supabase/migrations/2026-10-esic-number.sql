-- The ESIC insurance (IP) number of an employee: the 10-digit "Insurance No." on the ESIC e-Pehchan card. Optional. Safe to run again. Run it in the SQL editor.
-- Until it is run the field is simply not shown on the employee form, and nothing else is affected.
alter table public.employees add column if not exists esic_no text;
