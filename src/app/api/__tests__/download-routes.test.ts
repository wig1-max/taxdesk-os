import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Route tests for the streaming file/PDF download endpoints. Verifies:
 * - unauthenticated requests get 404 and never fetch the object,
 * - authenticated staff get a 200 STREAM (not a redirect to a signed URL),
 * - a missing row yields 404.
 */

let sessionUser: { id: string; role: string } | null = null;
let serverRow: unknown = null;
let downloadResult: { data: Blob | null; error: unknown } = { data: null, error: null };
const downloadSpy = vi.fn(async () => downloadResult);

vi.mock("@/lib/auth", () => ({ getSessionUser: async () => sessionUser }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: async () => ({ allowed: true, degraded: false }),
}));
vi.mock("@/lib/audit", () => ({ audit: async () => {} }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {
        select: () => b,
        eq: () => b,
        is: () => b,
        order: () => b,
        limit: () => b,
        in: () => b,
        maybeSingle: async () => ({ data: serverRow }),
        single: async () => ({ data: serverRow }),
      };
      return b;
    },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ storage: { from: () => ({ download: downloadSpy }) } }),
}));

import { GET as filesGET } from "@/app/api/files/[id]/route";
import { GET as pdfsGET } from "@/app/api/pdfs/[id]/route";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const req = () => new Request("http://localhost/download") as any;
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  sessionUser = null;
  serverRow = null;
  downloadResult = { data: null, error: null };
  downloadSpy.mockClear();
});

describe("GET /api/files/:id", () => {
  it("404s an unauthenticated request and never fetches the object", async () => {
    const res = await filesGET(req(), ctx("f1"));
    expect(res.status).toBe(404);
    expect(downloadSpy).not.toHaveBeenCalled();
  });

  it("streams the file for staff (200, headers, not a redirect)", async () => {
    sessionUser = { id: "u1", role: "staff" };
    serverRow = {
      id: "f1",
      case_id: "c1",
      storage_path: "cases/c1/x.pdf",
      original_filename: "स्कैन copy.pdf",
      mime_type: "application/pdf",
      purged_at: null,
    };
    downloadResult = { data: new Blob(["%PDF-1.4 fake"]), error: null };

    const res = await filesGET(req(), ctx("f1"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toContain("filename*");
    expect(res.headers.get("location")).toBeNull(); // NOT a signed-URL redirect
    expect(await res.text()).toContain("%PDF");
  });

  it("404s when the file row is missing/purged", async () => {
    sessionUser = { id: "u1", role: "staff" };
    serverRow = null;
    const res = await filesGET(req(), ctx("missing"));
    expect(res.status).toBe(404);
  });
});

describe("GET /api/pdfs/:id", () => {
  it("404s an unauthenticated request", async () => {
    const res = await pdfsGET(req(), ctx("p1"));
    expect(res.status).toBe(404);
    expect(downloadSpy).not.toHaveBeenCalled();
  });

  it("streams the PDF for staff with a derived filename", async () => {
    sessionUser = { id: "u1", role: "admin" };
    serverRow = {
      id: "p1",
      case_id: "c1",
      storage_path: "cases/c1/iepf_authorization-1.pdf",
      cases: { display_code: "TDX-IEPF-0001" },
      pdf_templates: { code: "iepf_authorization" },
    };
    downloadResult = { data: new Blob(["%PDF-1.4 fake"]), error: null };

    const res = await pdfsGET(req(), ctx("p1"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toContain("TDX-IEPF-0001-iepf_authorization.pdf");
    expect(res.headers.get("location")).toBeNull();
  });
});
