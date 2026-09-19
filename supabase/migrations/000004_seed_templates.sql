-- ============================================================
-- TaxDesk OS — 000004 configuration seed (idempotent)
-- Services + status flows, document requirements, PDF templates,
-- message templates, settings. NO client data here — synthetic
-- demo clients live in supabase/seed.sql (dev only).
-- Re-running this migration is safe: everything upserts.
-- ============================================================

-- ------------------------------------------------------------
-- Services (status flows inline as JSONB; generic and lead flows
-- are repeated verbatim per service — boring beats clever)
-- ------------------------------------------------------------
insert into public.services (code, name, workflow_type, status_flow, default_fee_config)
values
(
  'itr', 'ITR Filing', 'full',
  $${
    "initial": "new_lead",
    "terminal": ["completed"],
    "hold": "on_hold",
    "filing_confirmation_required": ["filed"],
    "statuses": [
      {"code":"new_lead","label":"New lead","next_action":"Call client, confirm scope and fee"},
      {"code":"basic_details_pending","label":"Basic details pending","next_action":"Collect PAN, contact and bank details"},
      {"code":"documents_pending","label":"Documents pending","next_action":"Send checklist and upload link"},
      {"code":"documents_received","label":"Documents received","next_action":"Review and verify documents"},
      {"code":"computation_in_progress","label":"Computation in progress","next_action":"Prepare computation summary"},
      {"code":"client_approval_pending","label":"Client approval pending","next_action":"Send computation for approval"},
      {"code":"approved_by_client","label":"Approved by client","next_action":"File return manually after review"},
      {"code":"filed","label":"Filed","next_action":"Confirm e-verification with client"},
      {"code":"e_verified","label":"E-verified","next_action":"Collect balance fee, send completion update"},
      {"code":"completed","label":"Completed","next_action":"Ask for review/referral"},
      {"code":"on_hold","label":"On hold","next_action":"Record reason and revisit date"}
    ]
  }$$::jsonb,
  '{"fixed_options":{"salaried":1500,"business":3500},"note":"placeholder amounts - confirm with owner"}'::jsonb
),
(
  'iepf', 'IEPF Claim Recovery', 'full',
  $${
    "initial": "new_lead",
    "terminal": ["completed"],
    "hold": "on_hold",
    "filing_confirmation_required": ["iepf5_uploaded","srn_generated"],
    "guards": {
      "before_iepf5_preparation": ["identity_review_complete","authorization_verified","fee_agreement_verified","upfront_fee_recorded"]
    },
    "statuses": [
      {"code":"new_lead","label":"New lead","next_action":"Explain process and fees, schedule visit"},
      {"code":"folio_details_pending","label":"Folio/company details pending","next_action":"Collect company, folio and share details"},
      {"code":"documents_pending","label":"Documents pending","next_action":"Send visit checklist and upload link"},
      {"code":"documents_received","label":"Documents received","next_action":"Verify each document"},
      {"code":"documents_verified","label":"Documents verified","next_action":"Prepare authorization letter and fee agreement"},
      {"code":"authorization_signed","label":"Authorization signed","next_action":"Get fee agreement signed"},
      {"code":"fee_agreement_signed","label":"Fee agreement signed","next_action":"Collect upfront fee"},
      {"code":"iepf5_preparation","label":"IEPF-5 preparation","next_action":"Prepare IEPF-5 manually, internal review"},
      {"code":"iepf5_uploaded","label":"IEPF-5 uploaded","next_action":"Record SRN when generated"},
      {"code":"srn_generated","label":"SRN generated","next_action":"Prepare physical dispatch pack"},
      {"code":"dispatch_pending","label":"Physical dispatch pending","next_action":"Dispatch to company/RTA, record tracking number"},
      {"code":"sent_to_rta","label":"Sent to company/RTA","next_action":"Diarize follow-up in 30 days"},
      {"code":"objection_received","label":"Objection received","next_action":"Draft objection reply"},
      {"code":"objection_reply_pending","label":"Objection reply pending","next_action":"Send reply and record dispatch"},
      {"code":"under_verification","label":"Under verification","next_action":"Follow up with company/RTA"},
      {"code":"approved","label":"Approved","next_action":"Monitor credit to demat/bank"},
      {"code":"credited","label":"Credited to demat/bank","next_action":"Compute final fee, raise balance demand"},
      {"code":"balance_fee_pending","label":"Balance fee pending","next_action":"Follow up for balance fee"},
      {"code":"completed","label":"Completed","next_action":"Ask for review/referral"},
      {"code":"on_hold","label":"On hold","next_action":"Record reason and revisit date"}
    ]
  }$$::jsonb,
  '{"percent":15,"upfront":5000}'::jsonb
),
(
  'gst', 'GST Registration/Filing', 'generic',
  $${
    "initial": "new_lead",
    "terminal": ["completed"],
    "hold": "on_hold",
    "statuses": [
      {"code":"new_lead","label":"New lead","next_action":"Confirm scope and fee"},
      {"code":"documents_pending","label":"Documents pending","next_action":"Send checklist and upload link"},
      {"code":"in_progress","label":"In progress","next_action":"Prepare application/filing"},
      {"code":"awaiting_client","label":"Awaiting client","next_action":"Follow up with client"},
      {"code":"submitted","label":"Submitted","next_action":"Track acknowledgement/approval"},
      {"code":"completed","label":"Completed","next_action":"Ask for review/referral"},
      {"code":"on_hold","label":"On hold","next_action":"Record reason and revisit date"}
    ]
  }$$::jsonb,
  '{}'::jsonb
),
(
  'business_reg', 'Business Registration / Udyam / MSME', 'generic',
  $${
    "initial": "new_lead",
    "terminal": ["completed"],
    "hold": "on_hold",
    "statuses": [
      {"code":"new_lead","label":"New lead","next_action":"Confirm scope and fee"},
      {"code":"documents_pending","label":"Documents pending","next_action":"Send checklist and upload link"},
      {"code":"in_progress","label":"In progress","next_action":"Prepare application/filing"},
      {"code":"awaiting_client","label":"Awaiting client","next_action":"Follow up with client"},
      {"code":"submitted","label":"Submitted","next_action":"Track acknowledgement/approval"},
      {"code":"completed","label":"Completed","next_action":"Ask for review/referral"},
      {"code":"on_hold","label":"On hold","next_action":"Record reason and revisit date"}
    ]
  }$$::jsonb,
  '{}'::jsonb
),
(
  'govt_forms', 'Government Form Assistance', 'generic',
  $${
    "initial": "new_lead",
    "terminal": ["completed"],
    "hold": "on_hold",
    "statuses": [
      {"code":"new_lead","label":"New lead","next_action":"Confirm scope and fee"},
      {"code":"documents_pending","label":"Documents pending","next_action":"Send checklist and upload link"},
      {"code":"in_progress","label":"In progress","next_action":"Prepare application/filing"},
      {"code":"awaiting_client","label":"Awaiting client","next_action":"Follow up with client"},
      {"code":"submitted","label":"Submitted","next_action":"Track acknowledgement/approval"},
      {"code":"completed","label":"Completed","next_action":"Ask for review/referral"},
      {"code":"on_hold","label":"On hold","next_action":"Record reason and revisit date"}
    ]
  }$$::jsonb,
  '{}'::jsonb
),
(
  'mutual_fund', 'Mutual Fund Distribution', 'lead',
  $${
    "initial": "new_lead",
    "terminal": ["converted","not_interested"],
    "hold": "on_hold",
    "compliance_note": "Distribution only - no scheme recommendations, no returns projections.",
    "statuses": [
      {"code":"new_lead","label":"New lead","next_action":"Contact and understand need"},
      {"code":"contacted","label":"Contacted","next_action":"Collect KYC documents"},
      {"code":"kyc_pending","label":"Docs/KYC pending","next_action":"Follow up for KYC"},
      {"code":"submitted_to_partner","label":"Submitted to partner","next_action":"Track partner processing"},
      {"code":"in_process","label":"In process","next_action":"Follow up with partner/platform"},
      {"code":"converted","label":"Converted","next_action":"Ask for review/referral"},
      {"code":"not_interested","label":"Not interested","next_action":"Close politely, keep for future"},
      {"code":"on_hold","label":"On hold","next_action":"Record reason and revisit date"}
    ]
  }$$::jsonb,
  '{}'::jsonb
),
(
  'insurance', 'Insurance', 'lead',
  $${
    "initial": "new_lead",
    "terminal": ["converted","not_interested"],
    "hold": "on_hold",
    "compliance_note": "Lead handling only - no product claims in client messages.",
    "statuses": [
      {"code":"new_lead","label":"New lead","next_action":"Contact and understand need"},
      {"code":"contacted","label":"Contacted","next_action":"Collect KYC documents"},
      {"code":"kyc_pending","label":"Docs/KYC pending","next_action":"Follow up for KYC"},
      {"code":"submitted_to_partner","label":"Submitted to partner","next_action":"Track partner processing"},
      {"code":"in_process","label":"In process","next_action":"Follow up with partner/platform"},
      {"code":"converted","label":"Converted","next_action":"Ask for review/referral"},
      {"code":"not_interested","label":"Not interested","next_action":"Close politely, keep for future"},
      {"code":"on_hold","label":"On hold","next_action":"Record reason and revisit date"}
    ]
  }$$::jsonb,
  '{}'::jsonb
),
(
  'loan_dsa', 'Loan DSA', 'lead',
  $${
    "initial": "new_lead",
    "terminal": ["converted","not_interested"],
    "hold": "on_hold",
    "compliance_note": "Lead handling only.",
    "statuses": [
      {"code":"new_lead","label":"New lead","next_action":"Contact and understand need"},
      {"code":"contacted","label":"Contacted","next_action":"Collect KYC documents"},
      {"code":"kyc_pending","label":"Docs/KYC pending","next_action":"Follow up for KYC"},
      {"code":"submitted_to_partner","label":"Submitted to partner","next_action":"Track partner processing"},
      {"code":"in_process","label":"In process","next_action":"Follow up with partner/platform"},
      {"code":"converted","label":"Converted","next_action":"Ask for review/referral"},
      {"code":"not_interested","label":"Not interested","next_action":"Close politely, keep for future"},
      {"code":"on_hold","label":"On hold","next_action":"Record reason and revisit date"}
    ]
  }$$::jsonb,
  '{}'::jsonb
)
on conflict (code) do update
set name = excluded.name,
    workflow_type = excluded.workflow_type,
    status_flow = excluded.status_flow,
    default_fee_config = excluded.default_fee_config;

-- ------------------------------------------------------------
-- Document requirements
-- Aadhaar items are NOT required and carry the default-deny note:
-- the upload UI only offers them when cases.aadhaar_required = true
-- (flag needs a reason; upload needs consent; file gets
-- contains_aadhaar = true and joins the early-purge queue).
-- ------------------------------------------------------------
insert into public.document_requirements
  (service_id, code, name, is_required, condition_note, sort_order)
select s.id, r.code, r.name, r.is_required, r.condition_note, r.sort_order
from public.services s
join (
  values
  -- ITR
  ('itr','pan','PAN card',true,null,10),
  ('itr','aadhaar_card','Aadhaar card',false,'DEFAULT DENY: only if aadhaar_required is set on the case with reason + consent',20),
  ('itr','bank_details','Bank details (account + IFSC proof)',true,null,30),
  ('itr','form16','Form 16 (per employer)',true,'If salaried',40),
  ('itr','ais','AIS',true,null,50),
  ('itr','form_26as','Form 26AS',true,null,60),
  ('itr','capital_gains_stmt','Capital gains statement',false,'Only if shares/MF traded',70),
  ('itr','bank_interest','Bank interest details',true,null,80),
  ('itr','business_income','Business/professional income details',false,'Only if business income',90),
  ('itr','prev_itr','Previous year ITR',false,'If available',100),
  ('itr','hra_rent_receipts','Rent receipts / HRA proof',false,'If claiming HRA',110),
  ('itr','investment_proofs','80C/80D investment proofs',false,'Old regime only',120),
  ('itr','client_approval','Client approval confirmation',true,'Approval sheet or logged WhatsApp confirmation',130),
  -- IEPF
  ('iepf','pan','PAN card',true,null,10),
  ('iepf','aadhaar_card','Aadhaar card',false,'DEFAULT DENY: only if aadhaar_required is set on the case with reason + consent',20),
  ('iepf','cml','Latest Client Master List (CML)',true,null,30),
  ('iepf','bank_proof','Cancelled cheque / bank proof',true,null,40),
  ('iepf','share_certificate','Old share certificate / folio details',true,null,50),
  ('iepf','entitlement_letter','Entitlement letter',false,'If applicable',60),
  ('iepf','dividend_warrant','Dividend warrant / proof of entitlement',false,'If available',70),
  ('iepf','authorization_letter','Authorization letter (signed)',true,null,80),
  ('iepf','fee_agreement','Fee agreement (signed)',true,null,90),
  ('iepf','advance_receipt','Advance stamped receipt',true,null,100),
  ('iepf','affidavit_same_person','Same-person affidavit',false,'If name mismatch found in identity review',110),
  ('iepf','affidavit_address','Change-of-address affidavit',false,'If address mismatch found in identity review',120),
  ('iepf','indemnity_bond','Indemnity bond',true,null,130),
  ('iepf','isr1','ISR-1',true,null,140),
  ('iepf','isr2','ISR-2',true,null,150),
  ('iepf','sh13_isr3','SH-13 or ISR-3',true,null,160),
  ('iepf','death_certificate','Death certificate',false,'Joint holder / deceased cases',170),
  ('iepf','succession_docs','Succession / legal heir documents',false,'If applicable',180),
  ('iepf','dispatch_tracking','Physical dispatch tracking details',true,'Recorded at dispatch stage',190),
  ('iepf','srn_ack','SRN / acknowledgement copy',true,'Recorded after upload',200),
  -- GST / generic starter
  ('gst','pan','PAN card',true,null,10),
  ('gst','business_proof','Business proof (registration/partnership deed)',true,null,20),
  ('gst','address_proof','Business address proof',true,null,30),
  ('gst','bank_proof','Bank proof (cancelled cheque/statement)',true,null,40),
  ('gst','photo','Proprietor/partner photo',true,null,50),
  ('gst','authorization','Authorization letter',false,'If filed via authorized signatory',60),
  -- Lead-workflow starter KYC
  ('mutual_fund','pan','PAN card',true,null,10),
  ('mutual_fund','kyc_form','KYC form',true,null,20),
  ('mutual_fund','bank_proof','Bank proof',true,null,30),
  ('mutual_fund','photo','Photograph',true,null,40),
  ('insurance','pan','PAN card',true,null,10),
  ('insurance','kyc_form','KYC form',true,null,20),
  ('insurance','bank_proof','Bank proof',true,null,30),
  ('insurance','photo','Photograph',true,null,40),
  ('loan_dsa','pan','PAN card',true,null,10),
  ('loan_dsa','kyc_form','KYC form / application',true,null,20),
  ('loan_dsa','bank_proof','Bank statements',true,null,30),
  ('loan_dsa','photo','Photograph',true,null,40)
) as r(service_code, code, name, is_required, condition_note, sort_order)
  on r.service_code = s.code
on conflict (service_id, code) do update
set name = excluded.name,
    is_required = excluded.is_required,
    condition_note = excluded.condition_note,
    sort_order = excluded.sort_order,
    is_active = true;

-- ------------------------------------------------------------
-- PDF templates (rendering happens in Phase E; body_config keeps
-- editable text blocks + the mandatory disclaimer)
-- ------------------------------------------------------------
insert into public.pdf_templates (code, name, service_id, body_config)
select t.code, t.name,
       (select id from public.services where code = t.service_code),
       t.body_config::jsonb
from (
  values
  ('itr_computation','ITR Computation Summary','itr',
   '{"watermark":"DRAFT","sections":["income_heads","deductions","tax_summary","regime"],"disclaimer":"Draft for review. Final filing is subject to verification and client approval. Demo Tax Practice does not provide investment advice."}'),
  ('itr_approval','ITR Client Approval Sheet','itr',
   '{"sections":["computation_reference","client_declaration","signature_blocks"],"disclaimer":"Final filing is subject to verification and client approval."}'),
  ('iepf_visit_checklist','IEPF Client Visit Checklist','iepf',
   '{"sections":["document_table","bring_sign_columns","office_contact"],"disclaimer":"Checklist for preparation only. Claim submission is subject to verification and client approval."}'),
  ('iepf_authorization','IEPF Authorization Letter','iepf',
   '{"sections":["authorization_text","folio_company_details","client_signature"],"disclaimer":"This authorization covers correspondence and claim pursuit. It does not authorize any login to government portals on the client''s behalf."}'),
  ('iepf_fee_agreement','IEPF Fee Agreement','iepf',
   '{"sections":["fee_terms_15_percent","upfront_5000","payment_schedule","non_refund_clause_placeholder","signature_blocks"],"disclaimer":"Fee terms as agreed. Recovery timelines depend on company/RTA and IEPF authority processing.","note":"Non-refund clause wording pending owner/CA confirmation (Phase A Q4)."}'),
  ('pending_docs_letter','Pending Documents Letter',null,
   '{"sections":["outstanding_items_table","respond_by_date"],"disclaimer":"Processing continues once all documents are received and verified."}')
) as t(code, name, service_code, body_config)
on conflict (code) do update
set name = excluded.name,
    service_id = excluded.service_id,
    body_config = excluded.body_config,
    is_active = true;

-- ------------------------------------------------------------
-- Message templates (copy-to-clipboard only; no WhatsApp API)
-- ------------------------------------------------------------
insert into public.message_templates (code, name, service_id, body, variables)
select t.code, t.name,
       (select id from public.services where code = t.service_code),
       t.body, t.variables
from (
  values
  ('welcome','New client welcome',null,
   'Namaste {{client_name}} ji, welcome to Demo Tax Practice. Aapka {{service_name}} ka kaam humne shuru kar diya hai. Aapke case ka reference number hai {{case_code}}. Kisi bhi update ke liye aap humein isi number par message kar sakte hain.',
   array['client_name','service_name','case_code']),
  ('doc_checklist','Document checklist',null,
   'Hello {{client_name}} ji, {{service_name}} ke liye humein ye documents chahiye: {{document_list}}. Aap documents is secure link par upload kar sakte hain (link {{expiry_hours}} hours tak valid hai): {{upload_link}}',
   array['client_name','service_name','document_list','expiry_hours','upload_link']),
  ('doc_reminder','Pending document reminder',null,
   'Hello {{client_name}} ji, gentle reminder — aapke {{service_name}} case ke liye ye documents abhi pending hain: {{pending_list}}. Jaldi bhejenge to kaam time par complete ho jayega. Dhanyavaad.',
   array['client_name','service_name','pending_list']),
  ('computation_approval','Computation approval request','itr',
   'Hello {{client_name}} ji, aapki ITR computation ready hai. Please attached summary check karke confirm kar dijiye, uske baad hum filing proceed karenge.',
   array['client_name']),
  ('iepf_authorization','IEPF authorization request','iepf',
   'Hello {{client_name}} ji, aapke IEPF claim ke liye authorization letter aur fee agreement ready hain. Please office visit karke ya courier se sign karke bhej dijiye, tabhi hum claim file kar payenge.',
   array['client_name']),
  ('upfront_fee','Upfront fee request',null,
   'Hello {{client_name}} ji, aapke {{service_name}} case ko aage badhane ke liye advance fee Rs. {{amount}} due hai. Aap UPI ya bank transfer se payment kar sakte hain. Payment details: {{payment_details}}. Receipt hum turant share kar denge.',
   array['client_name','service_name','amount','payment_details']),
  ('filing_done','Filing completed update',null,
   'Good news {{client_name}} ji! Aapki {{service_name}} filing complete ho gayi hai. Reference/acknowledgement: {{reference}}. Agla step: {{next_step}}. Thank you for trusting TaxDesk OS.',
   array['client_name','service_name','reference','next_step']),
  ('iepf_srn','IEPF SRN update','iepf',
   'Update {{client_name}} ji: aapka IEPF-5 form file ho gaya hai. SRN number: {{srn}}. Ab company/RTA verification process hogi, jisme kuch mahine lag sakte hain. Hum har update aapko dete rahenge.',
   array['client_name','srn']),
  ('objection_update','Objection received update','iepf',
   'Hello {{client_name}} ji, aapke IEPF claim par company/RTA se ek query aayi hai: {{objection_summary}}. Hum iska reply prepare kar rahe hain. {{required_from_client}}',
   array['client_name','objection_summary','required_from_client']),
  ('balance_fee','Balance fee reminder','iepf',
   'Hello {{client_name}} ji, khushi ki baat hai — aapke IEPF claim ki value Rs. {{recovered_value}} aapke account me credit ho gayi hai. Agreement ke anusaar balance fee Rs. {{balance_amount}} due hai. Payment details: {{payment_details}}. Dhanyavaad.',
   array['client_name','recovered_value','balance_amount','payment_details']),
  ('review_referral','Review/referral request',null,
   'Thank you {{client_name}} ji! Aapka kaam complete hua, humein seva ka mauka dene ke liye dhanyavaad. Agar aap satisfied hain to apne friends/family ko TaxDesk OS recommend zaroor karein.',
   array['client_name'])
) as t(code, name, service_code, body, variables)
on conflict (code) do update
set name = excluded.name,
    service_id = excluded.service_id,
    body = excluded.body,
    variables = excluded.variables,
    is_active = true;

-- ------------------------------------------------------------
-- Settings
-- ------------------------------------------------------------
insert into public.settings (key, value)
values
  ('company_profile',
   '{"name":"Demo Tax Practice","address":"<office address - fill in>","phone":"<office phone - fill in>","email":"<office email - fill in>","city":"Gurugram, India"}'::jsonb),
  ('upload_link_defaults',
   '{"default_expiry_hours":72,"max_expiry_hours":168,"default_max_uploads":10,"max_uploads_cap":25}'::jsonb),
  ('retention_policy',
   '{"itr_files_years":8,"iepf_files":"closure_plus_3_years","aadhaar_sensitive":"early_purge_queue_after_case_completion","note":"Confirm periods with owner (Phase A Q3); purge script in Phase F"}'::jsonb),
  ('consent_text_versions',
   '{"v1":"I consent to Demo Tax Practice collecting and storing these documents solely for processing my case. Documents are stored privately and used for no other purpose."}'::jsonb)
on conflict (key) do update
set value = excluded.value;
