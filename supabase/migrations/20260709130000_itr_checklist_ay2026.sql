-- ============================================================
-- TaxDesk OS — 20260709130000 ITR prep checklist top-up (K.2.3)
--
-- Adds AY 2026-27 ITR-preparation document_requirements that were
-- missing from the original seed (000004), for the EXISTING `itr`
-- service. Purely additive:
--   * `on conflict (service_id, code) do nothing` — never renames,
--     re-numbers or deactivates an existing requirement.
--   * New items apply to ITR cases created GOING FORWARD (case
--     creation instantiates case_documents from active requirements);
--     existing cases are intentionally not mutated.
--
-- Matches the seed style in 000004 (values-join keyed by service code).
-- ============================================================

insert into public.document_requirements
  (service_id, code, name, is_required, condition_note, sort_order)
select s.id, r.code, r.name, r.is_required, r.condition_note, r.sort_order
from public.services s
join (
  values
  ('itr','prefilled_json','Prefilled JSON (e-filing portal)',false,'Downloaded from the income tax e-filing portal to prefill the return',65),
  ('itr','dividend_statement','Dividend statement',false,'If dividend income received',85),
  ('itr','deduction_80d_proofs','80D health insurance premium proofs',false,'If claiming 80D (medical insurance)',121),
  ('itr','home_loan_interest','Home loan interest certificate',false,'If claiming home-loan interest (Sec 24(b) / 80EEA)',122),
  ('itr','tax_challan','Tax payment challan (advance / self-assessment)',false,'If any tax paid by challan',123),
  ('itr','other_supporting','Other supporting documents',false,'Any additional documents for this return',125)
) as r(service_code, code, name, is_required, condition_note, sort_order)
  on r.service_code = s.code
on conflict (service_id, code) do nothing;
