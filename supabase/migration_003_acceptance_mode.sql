-- =====================================================================
-- Migration 003 — acceptance by email reply (default) or signed copy; optional annexure wording.
-- Run ONCE in the Supabase SQL Editor (after 002). Only updates clauses/templates still on the original wording,
-- so anything you have edited yourself is left alone.
-- =====================================================================
update public.clauses set body = replace(body, 'If written acceptance and a signed copy of this letter are not received within 24 hours', 'If {{acceptance_condition}} within 24 hours')
  where letter_type = 'offer' and key = 'offer_validity' and body like '%If written acceptance and a signed copy of this letter are not received within 24 hours%';

update public.clauses set body = replace(body, 'please reply directly to this email stating "I accept the position" on or before the joining date, if not already done.', '{{appt_accept_instruction}}')
  where letter_type = 'appointment' and key = 'acceptance' and body like '%please reply directly to this email stating%';

update public.clauses set body = body || ' {{annexure_sentence}}'
  where letter_type = 'appointment' and key = 'compensation' and body not like '%annexure_sentence%' and body like '%Income Tax.';

update public.mail_templates set body = replace(body, 'Kindly sign and return a copy of the letter as a token of acceptance. Please note the validity of the offer as mentioned in the letter.',
  'This is a confidential email. To accept, please reply on this same email thread with the acceptance confirmation given at the end of the letter — a signed copy is not required. Please note the validity of the offer as mentioned in the letter.')
  where key = 'offer' and body like '%Kindly sign and return a copy of the letter%';
