-- Attendance (and everything that uses its roster: Sites today, Meals, Accommodation) lists only people who have been onboarded.
-- Someone still in the hiring pipeline (resume, call, interview, offer, appointment, forms) does not appear, even with a project and a joining date set.
-- Same as the 2026-10-attendance-accountability-transport.sql version, plus "stage = 'onboarded'" on both branches. Not applied automatically.
create or replace function public.attendance_roster(p_project uuid, p_from date, p_to date)
returns table (employee_id uuid, emp_no text, full_name text, designation text, week_off text, join_date date)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.can_attend(p_project) then raise exception 'Not allowed'; end if;
  return query
    select e.id, e.emp_no, e.full_name, e.designation, e.week_off, e.join_date from public.employees e
    where e.stage = 'onboarded'
      and ((e.project_id = p_project and e.outcome <> 'rejected' and e.join_date is not null and e.join_date <= p_to and (e.left_on is null or e.left_on >= p_from))
       or e.id in (select a.employee_id from public.attendance a where a.project_id = p_project and a.work_date between p_from and p_to))
    order by e.full_name;
end $$;
