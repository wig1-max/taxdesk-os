import { describe, expect, it } from "vitest";
import {
  filterNormalServices,
  filterTemplatesForService,
  isDeferredService,
  isNormalService,
} from "@/lib/services/catalog";

describe("service catalog — normal vs deferred", () => {
  it("treats itr and gst as normal", () => {
    expect(isNormalService("itr")).toBe(true);
    expect(isNormalService("gst")).toBe(true);
  });

  it("treats iepf and non-tax services as deferred", () => {
    for (const code of ["iepf", "mutual_fund", "insurance", "loan_dsa", "govt_forms", "business_reg"]) {
      expect(isNormalService(code)).toBe(false);
      expect(isDeferredService(code)).toBe(true);
    }
  });

  it("handles null/unknown codes as deferred", () => {
    expect(isNormalService(null)).toBe(false);
    expect(isNormalService(undefined)).toBe(false);
    expect(isDeferredService("something_new")).toBe(true);
  });

  it("filterNormalServices keeps only normal services, preserving order", () => {
    const services = [
      { code: "itr", name: "ITR Filing" },
      { code: "iepf", name: "IEPF Claim Recovery" },
      { code: "gst", name: "GST Registration/Filing" },
      { code: "insurance", name: "Insurance" },
    ];
    expect(filterNormalServices(services).map((s) => s.code)).toEqual(["itr", "gst"]);
  });
});

describe("message template filtering", () => {
  const templates = [
    { code: "welcome", service_code: null },
    { code: "computation_approval", service_code: "itr" },
    { code: "iepf_authorization", service_code: "iepf" },
    { code: "iepf_srn", service_code: "iepf" },
    { code: "review_referral", service_code: null },
  ];

  it("keeps current-service + generic, drops unrelated services", () => {
    const out = filterTemplatesForService(templates, "itr").map((t) => t.code);
    expect(out).toContain("welcome"); // generic
    expect(out).toContain("review_referral"); // generic
    expect(out).toContain("computation_approval"); // itr
    expect(out).not.toContain("iepf_authorization"); // unrelated service
    expect(out).not.toContain("iepf_srn");
  });

  it("for a deferred service still shows only its own + generic", () => {
    const out = filterTemplatesForService(templates, "iepf").map((t) => t.code);
    expect(out).toEqual(["welcome", "iepf_authorization", "iepf_srn", "review_referral"]);
  });
});
