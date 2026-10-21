-- =====================================================================
-- Migration 002 — salary calculator, Annexure A, all clauses optional, new clauses.
-- Run ONCE in the Supabase SQL Editor if you already ran schema.sql + seed.sql earlier.
-- =====================================================================
alter table public.employees add column if not exists salary jsonb default '{}'::jsonb;
alter table public.letters   add column if not exists annexure jsonb;

-- every clause becomes optional (nothing locked)
update public.clauses set is_core = false;

-- pre-ticked set = what your recent letters actually contain
update public.clauses set default_on = true  where letter_type = 'offer' and key in
  ('position','joining_probation','compensation','site_allowances','insurance_wc','ppe_safety','conduct_confidentiality','offer_validity');
update public.clauses set default_on = false where letter_type = 'offer' and key = 'documents_verification';

-- compensation wording now follows the CTC / in-hand / gross choice (only touches the untouched default text)
update public.clauses set title = '{{comp_heading}}',
  body = $$Your {{comp_label}} will be **{{comp_figure}} ({{comp_words}})** per month{{comp_suffix}}. {{comp_annexure_ref}}$$
  where letter_type = 'offer' and key = 'compensation' and body like 'Your Cost to Company (CTC) will be%';
update public.clauses set
  body = $$Your {{comp_label}} will be **{{comp_figure}} ({{comp_words}})** per month{{comp_suffix}}. Your salary, allowances, and benefits will be disbursed in accordance with company policy, subject to applicable statutory deductions such as Professional Tax, Provident Fund, and Income Tax.$$
  where letter_type = 'appointment' and key = 'compensation' and body like 'Your compensation will be%';

-- new clauses seen in your recent letters
insert into public.clauses (letter_type, key, title, body, is_core, default_on, sort_order) values
('offer','leave_lop','Leave Policy & Loss of Pay (LOP)',
$$- Any leave taken beyond the accrued limit or without prior written approval will be treated as Loss of Pay (LOP) and deducted from monthly compensation on a pro-rata daily wage basis.$$, false, true, 55),

('offer','leave_accrual_lop','Leave Policy & Loss of Pay (LOP) – with probation accrual',
$$- During the {{probation}} probation period, leave accrual will be 1 day per completed month of service (0.5 Casual Leave + 0.5 Sick Leave).
- Any leave taken beyond the accrued limit or without prior written approval will be treated as Loss of Pay (LOP) and deducted from monthly compensation on a pro-rata daily wage basis.$$, false, false, 56),

('offer','termination_notice','Termination & Notice Period',
$$During the probation period or upon confirmation, either party may terminate this employment agreement by giving thirty (30) days' written notice or basic salary in lieu thereof.$$, false, true, 75)
 on conflict (letter_type, key) do nothing;
