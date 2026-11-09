-- Gujarat police verification (PCC) form: "Labor Identification and Verification Form".
-- Per project (entered once for the site) and per person (the few details the app did not hold). Not applied automatically.
alter table public.projects
  add column if not exists police_verification boolean not null default false,   -- this site needs the PCC form: it is added to the joining kit
  add column if not exists unit_name text,              -- the unit / company at the site (blank = the project's client)
  add column if not exists unit_location text,          -- village, taluka (blank = the project's location)
  add column if not exists unit_border_distance text,
  add column if not exists unit_sensitive text,         -- 'Yes' / 'No'
  add column if not exists contract_until date,         -- contract period end; also the tentative leaving date
  add column if not exists site_incharge_phone text;

-- Per person, only what the police form needs that the app did not already hold (matching the forms actually submitted): the police station of the permanent address.
-- Caste, sarpanch, voter ID and birth certificate are left blank on the form, so they are not stored. PAN is printed only when asked for (its copy must then be attached).
alter table public.employees
  add column if not exists native_police_station text;  -- police station of the permanent address (optional)
