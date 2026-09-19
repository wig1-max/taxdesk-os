import { z } from "zod";
import { nonEmptyTrimmed } from "./common";

/** Roles a human admin may assign through the Users page. */
const assignableRoleSchema = z.enum(["admin", "staff"]);

/** Invite / create-user form input. */
export const inviteUserSchema = z.object({
  full_name: nonEmptyTrimmed("Full name", 120),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Enter a valid email address")
    .max(200),
  role: assignableRoleSchema,
  /** Also email a password-setup link (needs SMTP configured on the server). */
  sendSetupEmail: z.boolean().optional().default(false),
});

export type InviteUserInput = z.infer<typeof inviteUserSchema>;

export const changeRoleSchema = z.object({
  userId: z.string().uuid(),
  role: assignableRoleSchema,
});

export const setActiveSchema = z.object({
  userId: z.string().uuid(),
  isActive: z.boolean(),
});
