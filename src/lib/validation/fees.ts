import { z } from "zod";
import { dateStringSchema, uuidSchema } from "./common";

/** Pure fee math — unit-tested in Phase F. */
export function computeIepfFee(input: {
  estimated_claim_value: number;
  actual_recovered_value?: number;
  fee_percent: number;
  payments_received: number;
  override_total?: number;
}) {
  const expected_fee = Math.round(
    (input.estimated_claim_value * input.fee_percent) / 100
  );
  const final_fee =
    input.actual_recovered_value !== undefined
      ? Math.round((input.actual_recovered_value * input.fee_percent) / 100)
      : undefined;
  const effective_total = input.override_total ?? final_fee ?? expected_fee;
  const balance_fee_due = Math.max(
    0,
    effective_total - input.payments_received
  );
  return { expected_fee, final_fee, effective_total, balance_fee_due };
}

export const paymentSchema = z.object({
  fee_id: uuidSchema,
  case_id: uuidSchema,
  amount: z.coerce.number().positive("Amount must be positive"),
  direction: z.enum(["received", "refunded"]).default("received"),
  method: z.enum(["cash", "upi", "bank_transfer", "cheque", "other"]),
  reference: z.string().trim().max(120).optional(),
  paid_on: dateStringSchema,
  notes: z.string().trim().max(500).optional(),
});

export type PaymentInput = z.infer<typeof paymentSchema>;
