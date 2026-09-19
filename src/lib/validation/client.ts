import { z } from "zod";
import {
  dateStringSchema,
  nonEmptyTrimmed,
  panSchema,
  phoneSchema,
  pincodeSchema,
} from "./common";

/**
 * Client create/update input.
 * PAN arrives plaintext over TLS, is validated here, then immediately
 * encrypted server-side (lib/crypto/pan.ts). Only pan_last4 is stored
 * in plaintext. There is deliberately NO aadhaar field — and never will be.
 */
export const clientInputSchema = z.object({
  full_name: nonEmptyTrimmed("Full name", 120),
  primary_phone: phoneSchema,
  email: z.string().trim().email("Invalid email").max(254).optional().or(z.literal("")),
  pan: panSchema.optional().or(z.literal("")),
  date_of_birth: dateStringSchema.optional().or(z.literal("")),
  address_line1: z.string().trim().max(200).optional(),
  address_line2: z.string().trim().max(200).optional(),
  city: z.string().trim().max(100).optional(),
  state: z.string().trim().max(100).optional(),
  pincode: pincodeSchema.optional().or(z.literal("")),
  kyc_status: z.enum(["pending", "partial", "done"]).default("pending"),
  notes: z.string().trim().max(2000).optional(),
});

export type ClientInput = z.infer<typeof clientInputSchema>;
