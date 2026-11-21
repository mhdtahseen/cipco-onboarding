-- Where a vendor's trip went (the vendor page calls them trips; the office screens, errands): a From and a To, typed by the vendor, both required.
-- The office sees "From → To" on the trip. vendor_add_errand gains p_from / p_to (text); vendor_get returns them. Trips entered before this have none.
-- Safe to run more than once. Run AFTER 2026-11-transport-vendor-portal.sql.
alter table public.transport_errands add column if not exists from_place text not null default '';
alter table public.transport_errands add column if not exists to_place text not null default '';

drop function if exists public.vendor_add_errand(text, text, date, text, numeric, text);

create or replace function public.vendor_add_errand(p_token text, p_session text, p_date date, p_description text, p_amount numeric, p_asked_by text, p_from text default '', p_to text default '') returns jsonb
language plpgsql security definer set search_path = public as $$
declare l public.vendor_links := public.vendor_session(p_token, p_session); v public.transport_vehicles; id_ uuid;
  today date := (now() at time zone 'Asia/Kolkata')::date; d text := btrim(coalesce(p_description, '')); who text := btrim(coalesce(p_asked_by, ''));
  amt text; fp text := btrim(coalesce(p_from, '')); tp text := btrim(coalesce(p_to, ''));
begin
  if l.id is null then raise exception 'Please enter your PIN again.'; end if;
  select * into v from public.transport_vehicles where id = l.vehicle_id;
  if p_date is null or p_date > today then raise exception 'The date cannot be in the future.'; end if;
  if p_date < today - 7 then raise exception 'Errands older than 7 days cannot be added here. Call the CIPCO office.'; end if;
  if length(d) < 3 then raise exception 'Say what the errand was for.'; end if;
  if length(d) > 300 then raise exception 'Keep the description under 300 letters.'; end if;
  if length(who) < 2 or length(who) > 80 then raise exception 'Say who asked you to run it.'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Enter the amount you quoted.'; end if;
  if p_amount > 50000 then raise exception 'For more than ₹50,000, call the CIPCO office.'; end if;
  if (select count(*) from public.transport_errands where vendor_link_id = l.id and created_at > now() - interval '1 day') >= 15 then raise exception 'Too many errands today. Call the CIPCO office.'; end if;
  -- where from and where to
  if length(fp) < 2 then raise exception 'Say where the trip started.'; end if;
  if length(tp) < 2 then raise exception 'Say where the trip ended.'; end if;
  if length(fp) > 120 or length(tp) > 120 then raise exception 'Keep each place under 120 letters.'; end if;
  perform set_config('cipco.vendor_link', l.id::text, true);
  insert into public.transport_errands (vehicle_id, work_date, description, amount, quoted_amount, asked_by, from_place, to_place)
    values (v.id, p_date, d, null, round(p_amount, 2), who, fp, tp) returning id into id_;
  perform set_config('cipco.vendor_link', '', true);
  amt := case when p_amount = trunc(p_amount) then trunc(p_amount)::bigint::text else round(p_amount, 2)::text end;
  return jsonb_build_object('id', id_,
    'title', 'Trip to approve: ' || v.name,
    'body', '₹' || amt || ' · ' || fp || ' → ' || tp || ' · ' || left(d, 70) || ' · asked by ' || who || ' · ' || to_char(p_date, 'DD Mon'),
    'url', '/transport?p=' || v.project_id || '&tab=errands',
    'recipients', coalesce((select jsonb_agg(r.user_id) from public.user_roles r where r.role = 'admin' and not coalesce(r.practice, false)), '[]'::jsonb));
end $$;

create or replace function public.vendor_get(p_token text, p_session text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare l public.vendor_links := public.vendor_session(p_token, p_session); v public.transport_vehicles;
begin
  if l.id is null then
    if not exists (select 1 from public.vendor_links where token = p_token and revoked_at is null) then return jsonb_build_object('ok', false, 'gone', true); end if;
    return jsonb_build_object('ok', false, 'pin', true);
  end if;
  select * into v from public.transport_vehicles where id = l.vehicle_id;
  return jsonb_build_object('ok', true,
    'today', (now() at time zone 'Asia/Kolkata')::date,
    'vehicle', jsonb_build_object('id', v.id, 'project_id', v.project_id, 'name', v.name, 'operator', v.operator, 'billing', v.billing, 'active', v.active, 'sort_order', v.sort_order),
    'project', (select p.name from public.projects p where p.id = v.project_id),
    'rates', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'vehicle_id', r.vehicle_id, 'price', r.price, 'effective_from', r.effective_from) order by r.effective_from) from public.transport_rates r where r.vehicle_id = v.id), '[]'::jsonb),
    'runs', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'project_id', r.project_id, 'vehicle_id', r.vehicle_id, 'work_date', r.work_date, 'leg', r.leg, 'status', r.status, 'at', null) order by r.work_date, r.leg)
      from public.transport_runs r where r.vehicle_id = v.id and r.project_id = v.project_id), '[]'::jsonb),
    'errands', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'vehicle_id', e.vehicle_id, 'work_date', e.work_date, 'description', e.description, 'amount', e.amount, 'quoted_amount', e.quoted_amount,
        'approval', e.approval, 'source', e.source, 'asked_by', e.asked_by, 'from_place', e.from_place, 'to_place', e.to_place, 'decision_note', e.decision_note, 'decided_at', e.decided_at, 'created_at', e.created_at, 'voided_at', null) order by e.work_date desc, e.created_at desc)
      from public.transport_errands e where e.vehicle_id = v.id and e.voided_at is null), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'vehicle_id', p.vehicle_id, 'paid_on', p.paid_on, 'amount', p.amount, 'reference', p.reference, 'voided_at', null) order by p.paid_on desc, p.created_at desc)
      from public.transport_payments p where p.vehicle_id = v.id and p.voided_at is null), '[]'::jsonb),
    -- who may have asked: Admins and Operations, and the Site Engineers and Supervisors of this vehicle's project. Names only.
    'askers', coalesce((select jsonb_agg(n order by n) from (select distinct btrim(up.full_name) as n from public.user_roles r join public.user_profiles up on up.user_id = r.user_id
        where btrim(coalesce(up.full_name, '')) <> '' and not coalesce(r.practice, false)
          and (r.role in ('admin', 'staff') or (r.role in ('site_engineer', 'supervisor') and exists (select 1 from public.user_projects x where x.user_id = r.user_id and x.project_id = v.project_id)))) q), '[]'::jsonb));
end $$;

revoke all on function public.vendor_add_errand(text, text, date, text, numeric, text, text, text) from public;
grant execute on function public.vendor_add_errand(text, text, date, text, numeric, text, text, text) to anon, authenticated;
