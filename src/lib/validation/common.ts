import { z } from "zod";

/** Indian mobile: 10 digits starting 6-9, optional +91 prefix. Normalized to 10 digits. */
export const phoneSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-]/g, "").replace(/^\+91/, ""))
  .pipe(
    z.string().regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit Indian mobile number")
  );

export const panSchema = z
  .string()
  .trim()
  .transform((v) => v.toUpperCase())
  .pipe(
    z
      .string()
      .regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, "PAN must look like ABCDE1234F")
  );

export const pincodeSchema = z
  .string()
  .trim()
  .regex(/^[1-9]\d{5}$/, "Enter a valid 6-digit PIN code");

export const uuidSchema = z.string().uuid();

/** yyyy-mm-dd date string (HTML date inputs). */
export const dateStringSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .refine((v) => !Number.isNaN(Date.parse(v)), "Invalid date");

export const inrAmountSchema = z.coerce
  .number()
  .nonnegative("Amount cannot be negative")
  .max(999_99_99_999, "Amount too large");

export const nonEmptyTrimmed = (label: string, max = 200) =>
  z.string().trim().min(1, `${label} is required`).max(max);
