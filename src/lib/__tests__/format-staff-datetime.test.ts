import { describe, expect, it } from "vitest";
import { formatStaffDate, formatStaffDateTime } from "@/lib/utils";

describe("formatStaffDate — stable IST staff date", () => {
  it("uses the office date across the UTC-to-IST day boundary", () => {
    expect(formatStaffDate("2026-07-11T22:03:00.000Z")).toBe("12 Jul 2026");
  });

  it("returns an em dash for null or invalid input", () => {
    expect(formatStaffDate(null)).toBe("—");
    expect(formatStaffDate(undefined)).toBe("—");
    expect(formatStaffDate("not-a-date")).toBe("—");
  });
});

describe("formatStaffDateTime — unambiguous IST staff timestamp", () => {
  it("formats an ISO instant as '<dd> <Mon> <yyyy>, <h>:<mm> <AM/PM> IST'", () => {
    // 2026-07-11T22:03:00Z → 12 Jul 2026, 3:33 AM IST (UTC+5:30).
    const out = formatStaffDateTime("2026-07-11T22:03:00.000Z");
    expect(out).toMatch(/^12 Jul 2026, 3:33\s?AM IST$/);
    expect(out).toContain("IST");
    expect(out).not.toMatch(/\//); // no numeric locale slashes
  });

  it("uses a month name, not a numeric month", () => {
    expect(formatStaffDateTime("2026-01-05T06:00:00.000Z")).toMatch(/Jan 2026/);
  });

  it("null / invalid → em dash", () => {
    expect(formatStaffDateTime(null)).toBe("—");
    expect(formatStaffDateTime(undefined)).toBe("—");
    expect(formatStaffDateTime("not-a-date")).toBe("—");
  });
});
