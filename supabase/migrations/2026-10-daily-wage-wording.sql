-- Daily-wage workers: the compensation clause said "per month" in fixed wording. It now says {{comp_period}}, which prints
-- "per month" for CTC / in-hand / gross salaries (unchanged) and "per day" for daily-wage workers.
-- Only clauses that still contain the standard "per month{{comp_suffix}}" wording are touched; customised ones are left alone.
update public.clauses
set body = replace(body, '** per month{{comp_suffix}}', '** {{comp_period}}{{comp_suffix}}')
where body like '%** per month{{comp_suffix}}%';
update public.clauses
set body = replace(body, ')** per month{{comp_suffix}}', ')** {{comp_period}}{{comp_suffix}}')
where body like '%)** per month{{comp_suffix}}%';
