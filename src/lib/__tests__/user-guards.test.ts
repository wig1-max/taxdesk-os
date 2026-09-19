import { describe, expect, it } from "vitest";
import {
  canChangeRole,
  canDeactivate,
  canReactivate,
  type TargetUser,
} from "@/lib/users/guards";

const ADMIN_A: TargetUser = { id: "a", role: "admin", is_active: true };
const ADMIN_B: TargetUser = { id: "b", role: "admin", is_active: true };
const STAFF_C: TargetUser = { id: "c", role: "staff", is_active: true };
const INACTIVE_D: TargetUser = { id: "d", role: "staff", is_active: false };

describe("canDeactivate", () => {
  it("blocks deactivating yourself", () => {
    expect(canDeactivate("a", ADMIN_A, 2).ok).toBe(false);
  });

  it("blocks the last active admin", () => {
    expect(canDeactivate("b", ADMIN_A, 1).ok).toBe(false);
  });

  it("allows deactivating an admin when another active admin exists", () => {
    expect(canDeactivate("b", ADMIN_A, 2).ok).toBe(true);
  });

  it("allows deactivating staff regardless of admin count", () => {
    expect(canDeactivate("a", STAFF_C, 1).ok).toBe(true);
  });

  it("blocks deactivating an already-inactive user", () => {
    expect(canDeactivate("a", INACTIVE_D, 2).ok).toBe(false);
  });
});

describe("canReactivate", () => {
  it("allows reactivating an inactive user", () => {
    expect(canReactivate(INACTIVE_D).ok).toBe(true);
  });
  it("blocks reactivating an already-active user", () => {
    expect(canReactivate(STAFF_C).ok).toBe(false);
  });
});

describe("canChangeRole", () => {
  it("blocks a no-op role change", () => {
    expect(canChangeRole("a", ADMIN_B, "admin", 2).ok).toBe(false);
  });

  it("blocks changing your own role", () => {
    expect(canChangeRole("a", ADMIN_A, "staff", 2).ok).toBe(false);
  });

  it("blocks demoting the last active admin", () => {
    expect(canChangeRole("b", ADMIN_A, "staff", 1).ok).toBe(false);
  });

  it("allows demoting an admin when another active admin exists", () => {
    expect(canChangeRole("b", ADMIN_A, "staff", 2).ok).toBe(true);
  });

  it("allows promoting staff to admin", () => {
    expect(canChangeRole("a", STAFF_C, "admin", 1).ok).toBe(true);
  });
});
