import { describe, it, expect } from "vitest";
import {
  buildErrorReport,
  formatErrorLine,
  normalizeTelemetryDigest,
  normalizeTelemetryRoute,
  redactText,
  type ErrorReport,
} from "./report-error";

/**
 * Phase K.2.9.7 — failure-telemetry redaction/formatting contract.
 *
 * The point of these tests is the PII guarantee: a failure record NEVER carries
 * a PAN/Aadhaar-shaped value, and it DOES carry the safe diagnostic context
 * (route, digest, timestamp, role, user id). Node env, React-free.
 */

const FIXED = new Date("2026-07-18T09:30:00.000Z");
const FAKE_PAN = "ABCDE1234F"; // valid PAN shape (never a real client value)
const FAKE_AADHAAR = "1234 5678 9012"; // valid Aadhaar shape

describe("redactText", () => {
  it("passes null/undefined through as null", () => {
    expect(redactText(null)).toBeNull();
    expect(redactText(undefined)).toBeNull();
  });

  it("scrubs a PAN-shaped token", () => {
    const out = redactText(`leaked ${FAKE_PAN} here`)!;
    expect(out).not.toContain(FAKE_PAN);
    expect(out).toContain("[REDACTED_PAN]");
  });

  it("scrubs an Aadhaar-shaped token (spaced and bare)", () => {
    expect(redactText(`x ${FAKE_AADHAAR} y`)!).toContain("[REDACTED_AADHAAR]");
    expect(redactText("aadhaar 123456789012 end")!).toContain("[REDACTED_AADHAAR]");
  });

  it("leaves safe strings (routes, UUIDs) untouched", () => {
    const route = "/tax-desk/cases/2f1c4a9e-0b3d-4c5e-8a1f-9d2e3c4b5a6f/ledgers";
    expect(redactText(route)).toBe(route);
  });
});

describe("buildErrorReport", () => {
  it("emits only safe context and stamps a default timestamp", () => {
    const report = buildErrorReport(
      { route: "/tax-desk/cases/2f1c4a9e-0b3d-4c5e-8a1f-9d2e3c4b5a6f/computation", digest: "9f3c2b", role: "staff", userId: "user-1" },
      FIXED,
    );
    expect(report).toEqual<ErrorReport>({
      kind: "client_error_boundary",
      route: "/tax-desk/cases/2f1c4a9e-0b3d-4c5e-8a1f-9d2e3c4b5a6f/computation",
      digest: "9f3c2b",
      timestamp: FIXED.toISOString(),
      role: "staff",
      userId: "user-1",
    });
  });

  it("never carries a PAN/Aadhaar even if one is (defensively) passed in any field", () => {
    const report = buildErrorReport(
      {
        route: `/tax-desk/${FAKE_PAN}`,
        digest: FAKE_AADHAAR,
        role: FAKE_PAN,
        userId: FAKE_AADHAAR,
      },
      FIXED,
    );
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain(FAKE_PAN);
    expect(serialized).not.toContain("123456789012");
    expect(serialized).not.toContain(FAKE_AADHAAR);
    expect(report.route).toBe("unknown");
    expect(report.digest).toBeNull();
  });

  it("falls back to safe defaults for missing route/nullable fields", () => {
    const report = buildErrorReport({ route: "" }, FIXED);
    expect(report.route).toBe("unknown");
    expect(report.digest).toBeNull();
    expect(report.role).toBeNull();
    expect(report.userId).toBeNull();
    expect(report.timestamp).toBe(FIXED.toISOString());
  });

  it("honors an explicit timestamp", () => {
    const report = buildErrorReport({ route: "/x", timestamp: "2020-01-01T00:00:00.000Z" }, FIXED);
    expect(report.timestamp).toBe("2020-01-01T00:00:00.000Z");
  });
});

describe("client telemetry input normalization", () => {
  it("accepts only bounded pathname and digest shapes", () => {
    expect(normalizeTelemetryRoute("/tax-desk/cases/2f1c4a9e-0b3d-4c5e-8a1f-9d2e3c4b5a6f/ledgers")).toBe("/tax-desk/cases/2f1c4a9e-0b3d-4c5e-8a1f-9d2e3c4b5a6f/ledgers");
    expect(normalizeTelemetryDigest("opaque_digest-1")).toBe("opaque_digest-1");
  });

  it("drops arbitrary client text before it can reach the log sink", () => {
    expect(normalizeTelemetryRoute(`error: password=secret ${FAKE_PAN}`)).toBe("unknown");
    expect(normalizeTelemetryDigest(`note ${FAKE_AADHAAR}`)).toBeNull();
  });
});

describe("formatErrorLine", () => {
  it("produces a greppable single line with the redacted record embedded", () => {
    const line = formatErrorLine(
      buildErrorReport({ route: "/tax-desk/cases/2f1c4a9e-0b3d-4c5e-8a1f-9d2e3c4b5a6f/validation", digest: "d1" }, FIXED),
    );
    expect(line.startsWith("[taxdesk.telemetry] ")).toBe(true);
    expect(line).not.toContain("\n");
    const parsed = JSON.parse(line.replace("[taxdesk.telemetry] ", "")) as ErrorReport;
    expect(parsed.route).toBe("/tax-desk/cases/2f1c4a9e-0b3d-4c5e-8a1f-9d2e3c4b5a6f/validation");
    expect(parsed.kind).toBe("client_error_boundary");
  });
});
