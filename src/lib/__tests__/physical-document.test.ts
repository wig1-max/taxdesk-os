import { describe, expect, it } from "vitest";
import { physicalDocumentSchema } from "@/lib/validation/physical-document";

const base = {
  case_id: "3f0e8f9a-0000-4000-8000-000000000001",
  name: "Original share certificate",
  received_date: "2026-07-01",
  received_by: "3f0e8f9a-0000-4000-8000-000000000002",
  storage_location: "Almirah 1 / File 3",
};

describe("physical document custody validation", () => {
  it("accepts a plain in-custody record", () => {
    const r = physicalDocumentSchema.safeParse({ ...base, custody_status: "in_custody" });
    expect(r.success).toBe(true);
  });

  it("dispatched requires courier + tracking number", () => {
    expect(
      physicalDocumentSchema.safeParse({
        ...base,
        custody_status: "dispatched",
        dispatched_date: "2026-07-02",
      }).success
    ).toBe(false);
    expect(
      physicalDocumentSchema.safeParse({
        ...base,
        custody_status: "dispatched",
        courier_name: "BlueDart",
        tracking_number: "BD123456",
        dispatched_date: "2026-07-02",
      }).success
    ).toBe(true);
  });

  it("returned requires returned_date and blocks without it", () => {
    expect(
      physicalDocumentSchema.safeParse({
        ...base,
        custody_status: "returned_to_client",
        returned_to: "Ramesh Testwala",
      }).success
    ).toBe(false);
    expect(
      physicalDocumentSchema.safeParse({
        ...base,
        custody_status: "returned_to_client",
        returned_date: "2026-07-03",
        returned_to: "Ramesh Testwala",
      }).success
    ).toBe(true);
  });

  it("defaults: expected status, return not required", () => {
    const r = physicalDocumentSchema.parse(base);
    expect(r.custody_status).toBe("expected");
    expect(r.return_required).toBe(false);
  });

  it("lost is a valid status (with notes recommended)", () => {
    expect(
      physicalDocumentSchema.safeParse({ ...base, custody_status: "lost", notes: "under trace" })
        .success
    ).toBe(true);
  });
});
