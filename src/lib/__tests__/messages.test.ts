import { describe, expect, it } from "vitest";
import {
  SAMPLE_PREVIEW_VARS,
  extractVariables,
  renderTemplate,
} from "@/lib/messages/render";

describe("template variable extraction", () => {
  it("finds unique variables incl. whitespace variants", () => {
    expect(
      extractVariables("Hi {{client_name}}, case {{ case_code }} for {{client_name}}")
    ).toEqual(["client_name", "case_code"]);
  });
  it("returns empty for plain text", () => {
    expect(extractVariables("no variables here")).toEqual([]);
  });
});

describe("message rendering", () => {
  it("substitutes known variables deterministically", () => {
    const r = renderTemplate("Hello {{client_name}} ji, case {{case_code}}.", {
      client_name: "Ramesh",
      case_code: "TDX-IEPF-0001",
    });
    expect(r.text).toBe("Hello Ramesh ji, case TDX-IEPF-0001.");
    expect(r.unresolved).toEqual([]);
  });

  it("leaves unknown variables literal and reports them", () => {
    const r = renderTemplate("Fee Rs. {{amount}} via {{payment_details}}", {
      amount: "5000",
    });
    expect(r.text).toBe("Fee Rs. 5000 via {{payment_details}}");
    expect(r.unresolved).toEqual(["payment_details"]);
  });

  it("treats empty/null values as unresolved (no silent blanks)", () => {
    const r = renderTemplate("SRN: {{srn}}", { srn: "" });
    expect(r.text).toBe("SRN: {{srn}}");
    expect(r.unresolved).toEqual(["srn"]);
  });

  it("is plain text only — HTML in template or variables stays literal", () => {
    const r = renderTemplate("Note: {{note}} <b>bold?</b>", {
      note: "<script>alert(1)</script>",
    });
    // Renderer performs no HTML parsing/escaping — output is the raw
    // string, which the UI puts in a <textarea>/text node only.
    expect(r.text).toBe("Note: <script>alert(1)</script> <b>bold?</b>");
    expect(r.unresolved).toEqual([]);
  });

  it("numbers are stringified; zero is a value, not unresolved", () => {
    const r = renderTemplate("Count {{n}}", { n: 0 });
    expect(r.text).toBe("Count 0");
    expect(r.unresolved).toEqual([]);
  });

  it("all seeded sample variables render the doc_checklist preview cleanly", () => {
    const body =
      "Hello {{client_name}} ji, {{service_name}} ke liye documents: {{document_list}}. Link ({{expiry_hours}} hours): {{upload_link}}";
    const r = renderTemplate(body, SAMPLE_PREVIEW_VARS);
    expect(r.unresolved).toEqual([]);
    expect(r.text).toContain("Ramesh Testwala");
  });
});
