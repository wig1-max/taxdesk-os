/**
 * Pure guard logic for admin user-management. Kept side-effect free so
 * the safety invariants (no self-lockout, never remove the last active
 * admin) are unit-tested without a database. The server actions in
 * src/app/actions/users.ts MUST route every mutation through these.
 */

export type UserRole = "admin" | "staff";

export interface TargetUser {
  id: string;
  role: UserRole;
  is_active: boolean;
}

export interface GuardResult {
  ok: boolean;
  error?: string;
}

const OK: GuardResult = { ok: true };

/**
 * Deactivation (is_active -> false).
 * Blocked when: acting on yourself, the target is already inactive, or
 * the target is the last remaining active admin.
 */
export function canDeactivate(
  actorId: string,
  target: TargetUser,
  activeAdminCount: number
): GuardResult {
  if (target.id === actorId) {
    return { ok: false, error: "You cannot deactivate your own account." };
  }
  if (!target.is_active) {
    return { ok: false, error: "User is already inactive." };
  }
  if (target.role === "admin" && activeAdminCount <= 1) {
    return { ok: false, error: "Cannot deactivate the last active admin." };
  }
  return OK;
}

/** Reactivation (is_active -> true). Allowed unless already active. */
export function canReactivate(target: TargetUser): GuardResult {
  if (target.is_active) {
    return { ok: false, error: "User is already active." };
  }
  return OK;
}

/**
 * Role change (admin <-> staff).
 * Blocked when: no actual change, acting on yourself (prevents an admin
 * demoting themselves into a lockout), or demoting the last active admin.
 */
export function canChangeRole(
  actorId: string,
  target: TargetUser,
  newRole: UserRole,
  activeAdminCount: number
): GuardResult {
  if (newRole === target.role) {
    return { ok: false, error: `User is already ${target.role}.` };
  }
  if (target.id === actorId) {
    return { ok: false, error: "You cannot change your own role." };
  }
  if (target.role === "admin" && newRole === "staff" && target.is_active && activeAdminCount <= 1) {
    return { ok: false, error: "Cannot demote the last active admin." };
  }
  return OK;
}
