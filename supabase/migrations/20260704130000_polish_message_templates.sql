-- ============================================================
-- TaxDesk OS — 20260704130000 message template copy polish
--
-- Grammar/clarity pass on the seeded Hinglish WhatsApp templates.
-- Copy-only: {{variables}} are unchanged, so message_templates.variables
-- stays correct. Idempotent — updates by code, safe on reset and push.
-- Style guardrails preserved: non-pushy TaxDesk OS tone, no legal/tax
-- guarantees, no guaranteed-IEPF-recovery wording, copy/log only
-- (nothing is auto-sent).
-- ============================================================

update public.message_templates set body =
  'Namaste {{client_name}} ji, Demo Tax Practice me aapka swagat hai. Aapka {{service_name}} ka kaam hum shuru kar rahe hain. Aapke case ka reference number hai {{case_code}}. Kisi bhi update ke liye aap humein isi number par message kar sakte hain.'
where code = 'welcome';

update public.message_templates set body =
  'Hello {{client_name}} ji, aapke {{service_name}} case ke liye ye documents abhi pending hain: {{pending_list}}. Aap ye jaldi bhej denge to hum kaam time par complete kar denge. Dhanyavaad.'
where code = 'doc_reminder';

update public.message_templates set body =
  'Hello {{client_name}} ji, aapki ITR computation ready hai. Please computation summary check karke confirm kar dijiye — uske baad hum filing aage badha denge.'
where code = 'computation_approval';

update public.message_templates set body =
  'Hello {{client_name}} ji, aapke IEPF claim ke liye authorization letter aur fee agreement ready hain. Please office aakar ya courier se sign karke bhej dijiye, tabhi hum claim file kar payenge.'
where code = 'iepf_authorization';

update public.message_templates set body =
  'Hello {{client_name}} ji, aapke {{service_name}} case ko aage badhane ke liye advance fee Rs. {{amount}} due hai. Aap UPI ya bank transfer se payment kar sakte hain. Payment details: {{payment_details}}. Receipt hum turant share kar denge.'
where code = 'upfront_fee';
