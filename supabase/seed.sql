-- =====================================================================
-- Sample clauses + mail templates (wording taken from your existing letters).
-- EVERY clause is optional (none is locked). "pre-ticked" = ticked by default in the letter screen.
-- Edit them later in the app (Clause library). Run AFTER schema.sql. Safe to re-run (won't overwrite edits).
-- Acceptance wording follows the letter screen choice (reply on the email thread / signed copy): {{acceptance_condition}} {{appt_accept_instruction}} {{annexure_sentence}}
-- Placeholders: {{full_name}} {{first_name}} {{designation}} {{department}} {{project}} {{site_location}} {{base_location}}
--   {{join_date}} {{probation}} and salary wording that follows the CTC / in-hand / gross choice:
--   {{comp_label}} {{comp_figure}} {{comp_words}} {{comp_suffix}} {{comp_annexure_ref}} {{comp_heading}}
--   plus {{ctc_figure}} {{inhand_figure}} {{gross_figure}} {{annual_ctc_figure}} (and *_words) if you want them directly.
-- =====================================================================
insert into public.clauses (letter_type, key, title, body, is_core, default_on, sort_order) values
('offer','position','Position & Work Location',
$$- **Designation:** {{designation}}
- **Department:** {{department}}
- **Work Location / Site:** {{site_location}}
- **Head Office / Base Location:** {{base_location}}$$, false, true, 10),

('offer','joining_probation','Date of Joining & Probation',
$$- **Date of Joining:** {{join_date}}
- **Probation Period:** You will be on probation for a period of {{probation}} from your date of joining. Upon successful completion of the probation period, your employment will be confirmed in writing.$$, false, true, 20),

('offer','compensation','{{comp_heading}}',
$$Your {{comp_label}} will be **{{comp_figure}} ({{comp_words}})** per month{{comp_suffix}}. {{comp_annexure_ref}}$$, false, true, 30),

('offer','site_allowances','Site Allowances & Special Benefits',
$$- **Travel, Food, & Accommodation (TFA):** All travel, food, lodging, and local transport expenses incurred for or during site duty at {{site_location}} shall be directly provided or fully reimbursed by CIPCO as per company policy.$$, false, true, 40),

('offer','accommodation','Accommodation',
$$- **Accommodation:** Company-arranged accommodation will be provided at or near {{site_location}} for the duration of your site deployment, on a shared basis as per company policy.$$, false, false, 45),

('offer','insurance_wc','Insurance & On-Site Protection',
$$- **Workmen's Compensation (WC) Cover:** In view of the site-execution nature of your role, CIPCO provides full coverage under the Workmen's Compensation / Employee's Compensation Policy for all site-related risks, injuries, or emergencies during duty hours.$$, false, true, 50),

('offer','leave_lop','Leave Policy & Loss of Pay (LOP)',
$$- Any leave taken beyond the accrued limit or without prior written approval will be treated as Loss of Pay (LOP) and deducted from monthly compensation on a pro-rata daily wage basis.$$, false, true, 55),

('offer','leave_accrual_lop','Leave Policy & Loss of Pay (LOP) – with probation accrual',
$$- During the {{probation}} probation period, leave accrual will be 1 day per completed month of service (0.5 Casual Leave + 0.5 Sick Leave).
- Any leave taken beyond the accrued limit or without prior written approval will be treated as Loss of Pay (LOP) and deducted from monthly compensation on a pro-rata daily wage basis.$$, false, false, 56),

('offer','ppe_safety','Mandatory Personal Protective Equipment (PPE) & Site Safety',
$$- **Provision of PPE:** CIPCO will provide all necessary high-grade Personal Protective Equipment (PPE)—including safety helmet, safety boots, high-visibility vest, and safety harness—at zero cost to you.
- **Mandatory Usage:** Wearing the prescribed PPE at all active erection/project sites at {{site_location}} is strictly mandatory.
- **Non-Compliance:** Bypassing safety regulations or failing to wear required safety gear will attract strict disciplinary action, including financial penalties or immediate termination of employment for gross misconduct.$$, false, true, 60),

('offer','overtime','Working Hours & Overtime',
$$Working hours will be as per the schedule of the assigned site. Overtime, where applicable and approved in advance by your reporting manager, will be compensated as per company policy and applicable law.$$, false, false, 65),

('offer','relocation','Transfer & Relocation',
$$You may be required to travel, relocate, or be deployed to any project site of the company or its clients, within or outside {{base_location}}, depending on business needs.$$, false, false, 70),

('offer','termination_notice','Termination & Notice Period',
$$During the probation period or upon confirmation, either party may terminate this employment agreement by giving thirty (30) days' written notice or basic salary in lieu thereof.$$, false, true, 75),

('offer','conduct_confidentiality','Code of Conduct & Confidentiality',
$$You will be governed by the rules, regulations, and policies of CIPCO as enforced from time to time. You shall maintain strict confidentiality regarding all project blueprints, client data, technical specifications, and business operations of the company.$$, false, true, 80),

('offer','documents_verification','Documents & Background Verification',
$$This offer is subject to submission of your Aadhaar, PAN, bank details, UAN (if any), educational and experience documents, medical fitness (Form 32 & 33) and a Police Clearance Certificate (PCC) before or on your date of joining. Any false information or misrepresentation will result in withdrawal of this offer or termination of employment.$$, false, false, 85),

('offer','offer_validity','Offer Validity',
$$This offer of employment is valid for twenty-four (24) hours from the date and time of issue. If {{acceptance_condition}} within 24 hours, this offer shall automatically lapse, become null and void, and be withdrawn from the table without further notice.$$, false, true, 90),

('appointment','position_joining','Position and Joining',
$$Your employment shall commence effective {{join_date}}. You are required to report directly to our project site located at {{site_location}}. As a {{designation}}, you will assist senior engineers with site operations, execution tasks, quality documentation, and daily reporting.$$, false, true, 10),

('appointment','compensation','Compensation and Benefits',
$$Your {{comp_label}} will be **{{comp_figure}} ({{comp_words}})** per month{{comp_suffix}}. Your salary, allowances, and benefits will be disbursed in accordance with company policy, subject to applicable statutory deductions such as Professional Tax, Provident Fund, and Income Tax. {{annexure_sentence}}$$, false, true, 20),

('appointment','probation','Probation Period',
$$You shall be on probation for a period of {{probation}} from your date of joining. Upon successful completion of your probation period, your employment will be confirmed in writing by management.$$, false, true, 30),

('appointment','place_hours','Place of Work and Hours of Work',
$$Your initial reporting location is the project site at {{site_location}}. You may be required to travel, relocate, or visit various project sites in connection with company business. Working hours will be governed by the standard operating hours of the assigned site.$$, false, true, 40),

('appointment','confidentiality','Confidentiality',
$$During your employment and thereafter, you shall maintain strict confidentiality regarding all proprietary information, project drawings, client lists, financial records, and operational strategies of CIPCO.$$, false, true, 50),

('appointment','termination','Termination of Employment',
$$During the probation period, either party may terminate this employment by giving thirty (30) days' notice in writing or payment in lieu thereof. Post confirmation, the notice period shall be sixty (60) days. The company reserves the right to terminate employment immediately for gross misconduct, breach of integrity, or violation of company policies.$$, false, true, 60),

('appointment','acceptance','Acceptance of Offer',
$$To confirm your acceptance of this offer and the terms outlined above, {{appt_accept_instruction}} We look forward to a mutually rewarding association.$$, false, true, 70)
 on conflict (letter_type, key) do nothing;

-- ---------------- MAIL TEMPLATES ----------------
insert into public.mail_templates (key, name, subject, body, sort_order) values
('offer','Offer letter','Offer of Employment – {{designation}} | CIPCO',
$$Dear {{first_name}},

Greetings from Chandrika Industrial Projects Company (CIPCO).

Please find attached your offer letter for the position of {{designation}} ({{department}}) at {{site_location}}.

This is a confidential email. To accept, please reply on this same email thread with the acceptance confirmation given at the end of the letter — a signed copy is not required. Please note the validity of the offer as mentioned in the letter.

Regards,
HR Department
Chandrika Industrial Projects Company
+91 98504 95483 | info@cipcogroup.com$$, 10),

('documents','Documents request','Documents required for joining – CIPCO',
$$Dear {{first_name}},

To complete your onboarding at CIPCO, please send us clear scans/photos of the following before your joining date ({{join_date}}):

1. Aadhaar card (front & back)
2. PAN card (if available)
3. Bank passbook first page / cancelled cheque
4. UAN number / previous PF details (if any)
5. Passport-size photographs (2)
6. Medical fitness certificate – Form 32 & Form 33
7. Police Clearance Certificate (PCC)

Regards,
HR Department
Chandrika Industrial Projects Company$$, 20),

('appointment','Appointment letter','Appointment Letter – {{designation}} | CIPCO',
$$Dear {{first_name}},

Congratulations and welcome to CIPCO!

Please find attached your appointment letter, along with the joining form, PF Form 11 and Gratuity nomination (Form F). Kindly fill, sign and bring the printed forms on your date of joining ({{join_date}}), along with the documents listed in the checklist.

Regards,
HR Department
Chandrika Industrial Projects Company$$, 30),

('welcome','Joining day instructions','Joining instructions – {{site_location}}',
$$Dear {{first_name}},

We look forward to having you join us on {{join_date}} at {{site_location}}.

Please report with your original ID proof, signed joining forms, medical certificates (Form 32 & 33), PCC and your own basic safety footwear if you have any. Our team will complete the safety induction and issue your PPE on arrival.

Regards,
HR Department
Chandrika Industrial Projects Company$$, 40)
 on conflict (key) do nothing;