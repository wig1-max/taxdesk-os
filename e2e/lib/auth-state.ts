/**
 * Path to the admin storage state written by the `setup` project and reused by
 * authenticated specs via `test.use({ storageState: ADMIN_STORAGE_STATE })`.
 * Kept in its own module (not playwright.config) so specs don't import the
 * whole config (default export + env side effects).
 * Resolved relative to the config rootDir (project root).
 */
export const ADMIN_STORAGE_STATE = "playwright/.auth/admin.json";

/** Path to the STAFF (role=staff) storage state, used to prove admin-only
 *  server guards (e.g. reopen). Written by the `setup` project. */
export const STAFF_STORAGE_STATE = "playwright/.auth/staff.json";
