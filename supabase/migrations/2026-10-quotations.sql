-- Quotation maker: quotations (snapshots), a reusable wording library, and the CIPCO/OPS/QTN/<year>/<nnnn> reference series.
-- Safe to run more than once. The seed rows are only inserted while the library is empty.
create table if not exists public.quotations (
  id uuid primary key default gen_random_uuid(),
  ref_no text unique,                                  -- assigned when issued
  status text not null default 'draft' check (status in ('draft','issued')),
  quote_date date not null default current_date,
  client_name text not null, client_short text not null default '', client_address text not null default '', kind_attn text not null default '',
  subject text not null default '', intro text not null default '',
  items jsonb not null default '[]', show_total boolean not null default false, show_gst boolean not null default false,
  notes jsonb not null default '[]', terms jsonb not null default '[]',
  include_scope boolean not null default false, scope jsonb not null default '[]',
  client_supply jsonb not null default '[]', our_supply jsonb not null default '[]',
  signatory text not null default '',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists public.quote_library (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('scope','client_supply','our_supply','note','payment_terms')),
  tag text,                                            -- job type for scope steps, e.g. 'Press ram cylinder overhaul'
  body text not null,                                  -- {{client}} is replaced by the client's short name
  default_on boolean not null default false,           -- pre-added to every new quotation
  sort_order int not null default 100,
  active boolean not null default true
);

alter table public.quotations enable row level security;
alter table public.quote_library enable row level security;
do $$ declare t text; begin
  foreach t in array array['quotations','quote_library'] loop
    execute format('drop policy if exists "auth all" on public.%I', t);
    execute format('create policy "auth all" on public.%I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- Reference numbers: quotations use CIPCO/OPS/QTN/<year>/<nnnn>; everything else keeps the HR format.
create or replace function public.next_ref(p_kind text) returns text
language plpgsql security definer as $$
declare y int := extract(year from now())::int; n int; code text;
begin
  insert into public.ref_counters(kind, year, last) values (p_kind, y, 1)
  on conflict (kind, year) do update set last = public.ref_counters.last + 1
  returning last into n;
  if p_kind = 'quotation' then return 'CIPCO/OPS/QTN/' || y || '/' || lpad(n::text, 4, '0'); end if;
  code := case p_kind when 'offer' then 'OL' when 'appointment' then 'APPT' else upper(p_kind) end;
  return 'CIPCO/HR/' || code || '/' || y || '/' || lpad(n::text, 4, '0');
end $$;
-- Quotations 0104 and 0105 already exist, so the next one issued is 0106.
insert into public.ref_counters(kind, year, last) values ('quotation', 2026, 105) on conflict do nothing;

insert into public.quote_library (kind, tag, body, default_on, sort_order)
select * from (values
  ('client_supply', null, 'Cranes (heavy cranes or hydras, EOT cranes), trailers, trucks, manlifts and any other lifting or moving equipment.', true, 10),
  ('client_supply', null, 'Oxygen, acetylene and LPG gas cylinders.', true, 20),
  ('client_supply', null, 'Electrical, compressed-air and water points near the work area, one point each.', true, 30),
  ('client_supply', null, 'Canteen facilities for our staff and workers.', true, 40),
  ('client_supply', null, 'Gate passes for our staff and workers.', true, 50),
  ('client_supply', null, 'All electrical disconnections (and reconnections, where required).', true, 60),
  ('client_supply', null, 'Diesel, cotton waste and hand gloves as required.', true, 70),
  ('client_supply', null, 'A first-aid facility.', true, 80),
  ('client_supply', null, 'Two sets of assembly and detailed drawings.', true, 90),
  ('client_supply', null, 'An office room and a storeroom near the work area for our tools and tackles.', true, 100),
  ('client_supply', null, 'Any fabrication work required at site will be charged extra, as per our quotation.', true, 110),
  ('client_supply', null, 'Scaffolding, platforms, stools and wooden blocks or stands.', false, 120),
  ('client_supply', null, 'Hard-chrome plating, machining and grinding of the parts.', false, 130),
  ('client_supply', null, 'Replacement of any missing parts.', false, 140),
  ('client_supply', null, 'Non-destructive tests such as radiography and DP tests.', false, 150),
  ('client_supply', null, 'Welding machines, gas-cutting sets and consumables (welding electrodes, grinding wheels, oxygen and LPG).', false, 160),
  ('client_supply', null, 'Hardware, piping, bend ties, hoses, clamps, Loctite and Araldite.', false, 170),
  ('client_supply', null, 'First-fill hydraulic oil.', false, 180),
  ('client_supply', null, 'Dry ice or liquid nitrogen at site.', false, 190),
  ('client_supply', null, 'Accommodation for our staff and workers near the company.', false, 200),
  ('our_supply', null, 'Managers, supervisors, and skilled, semi-skilled and unskilled manpower at site.', true, 10),
  ('our_supply', null, 'Transport for our staff, workers, tools and tackles.', true, 20),
  ('our_supply', null, 'Tools and tackles, welding machines, gas-cutting sets and similar equipment as required.', true, 30),
  ('our_supply', null, 'Personal protective equipment: safety belts, helmets, vests or jackets, safety shoes and gloves.', true, 40),
  ('our_supply', null, 'Workmen''s Compensation (WC) policy and insurance cover for our staff and workers.', true, 50),
  ('note', null, 'The heaviest item (approx. 100 MT) will need heavy cranes for dismantling. All necessary heavy cranes, trailers, trucks and moving equipment are within {{client}}''s scope. For all other items, the existing EOT cranes will be used for dismantling without disturbance.', false, 10),
  ('note', null, 'Because of the height of the heavy items during dismantling, they may reach the top ceiling of the shed. Removing the roof (sheets, insulation, etc.) will therefore also fall under {{client}}''s scope.', false, 20),
  ('payment_terms', null, E'20% advance along with PO\n80% against fortnightly RA bills', false, 10),
  ('payment_terms', null, E'25% advance along with PO\n45% after dismantling of the cylinder\n30% after assembly', false, 20),
  ('scope', 'Press ram cylinder overhaul', 'Drain the hydraulic oil and clean the storage tank.', false, 10),
  ('scope', 'Press ram cylinder overhaul', 'Lock out the electrical, hydraulic and accumulator systems.', false, 20),
  ('scope', 'Press ram cylinder overhaul', 'Lower the moving crosshead onto the support blocks.', false, 30),
  ('scope', 'Press ram cylinder overhaul', 'Depressurise the hydraulic system.', false, 40),
  ('scope', 'Press ram cylinder overhaul', 'Disconnect and cap all hydraulic lines.', false, 50),
  ('scope', 'Press ram cylinder overhaul', 'Remove the cylinder covers.', false, 60),
  ('scope', 'Press ram cylinder overhaul', 'Remove the piping, sensors and cooling lines.', false, 70),
  ('scope', 'Press ram cylinder overhaul', 'Match-mark every hydraulic connection before disconnecting it.', false, 80),
  ('scope', 'Press ram cylinder overhaul', 'Disconnect the piston rods from the moving crosshead.', false, 90),
  ('scope', 'Press ram cylinder overhaul', 'Remove the cylinder assemblies, left and right first and the centre one last.', false, 100),
  ('scope', 'Press ram cylinder overhaul', 'Disassemble the cylinders and inspect all parts.', false, 110),
  ('scope', 'Press ram cylinder overhaul', 'Send the parts out for re-chrome plating.', false, 120),
  ('scope', 'Press ram cylinder overhaul', 'After re-chrome plating, carry out grinding and honing.', false, 130),
  ('scope', 'Press ram cylinder overhaul', 'Lubricate all seals with hydraulic oil.', false, 140),
  ('scope', 'Press ram cylinder overhaul', 'Reassemble the cylinders: install the glands and piston, and tighten the piston retaining nut.', false, 150),
  ('scope', 'Press ram cylinder overhaul', 'Insert the rod assembly.', false, 160),
  ('scope', 'Press ram cylinder overhaul', 'Install the cylinders on the press and align them with the guide pins.', false, 170),
  ('scope', 'Press ram cylinder overhaul', 'Tighten the foundation bolts.', false, 180),
  ('scope', 'Press ram cylinder overhaul', 'Connect the piston rods to the crosshead.', false, 190),
  ('scope', 'Press ram cylinder overhaul', 'Reconnect the hydraulic lines and instrumentation.', false, 200),
  ('scope', 'Press ram cylinder overhaul', 'Fill with filtered hydraulic oil.', false, 210),
  ('scope', 'Press ram cylinder overhaul', 'Start the pumps at low pressure and stroke the cylinders slowly.', false, 220),
  ('scope', 'Press ram cylinder overhaul', 'Carry out no-load trials.', false, 230)
) as v(kind, tag, body, default_on, sort_order)
where not exists (select 1 from public.quote_library);
