import { describe, expect, it } from "vitest";
import {
  needsPanBlockingWarning,
  planClientWrite,
  resolveClientWriteResult,
} from "@/lib/pan-write-plan";

describe("PAN atomicity contract (Appendix C6)", () => {
  it("PAN present -> single service-role statement path", () => {
    expect(planClientWrite(true)).toBe("service_role_single_statement");
  });
  it("no PAN -> normal session client path", () => {
    expect(planClientWrite(false)).toBe("session_client");
  });

  it("atomic success with PAN: ok + panSaved", () => {
    const r = resolveClientWriteResult({
      rowSaved: true,
      clientId: "c1",
      panRequested: true,
      panWriteOk: true,
    });
    expect(r).toEqual({ ok: true, clientId: "c1", panSaved: true });
    expect(needsPanBlockingWarning(r)).toBe(false);
  });

  it("success without PAN: panSaved true (nothing was dropped)", () => {
    const r = resolveClientWriteResult({
      rowSaved: true,
      clientId: "c1",
      panRequested: false,
      panWriteOk: false,
    });
    expect(r.ok).toBe(true);
    expect(r.panSaved).toBe(true);
  });

  it("split-write partial failure: ok, panSaved:false, panError set, warning required", () => {
    const r = resolveClientWriteResult({
      rowSaved: true,
      clientId: "c1",
      panRequested: true,
      panWriteOk: false,
      panErrorMsg: "encryption service unavailable",
    });
    expect(r.ok).toBe(true);
    expect(r.panSaved).toBe(false);
    expect(r.panError).toMatch(/unavailable/);
    expect(needsPanBlockingWarning(r)).toBe(true); // UI must block — no plain success
  });

  it("row failure with PAN requested: plain failure, never a silent PAN drop", () => {
    const r = resolveClientWriteResult({
      rowSaved: false,
      panRequested: true,
      panWriteOk: false,
      rowErrorMsg: "insert failed",
    });
    expect(r.ok).toBe(false);
    expect(r.panSaved).toBe(false);
    expect(r.error).toBe("insert failed");
    expect(needsPanBlockingWarning(r)).toBe(false); // whole op failed; nothing partial
  });

  it("panSaved:false EXCLUSIVELY means partial PAN failure on ok results", () => {
    // every ok:true result with panSaved:false must carry panError
    const r = resolveClientWriteResult({
      rowSaved: true,
      clientId: "c1",
      panRequested: true,
      panWriteOk: false,
    });
    expect(r.ok && !r.panSaved && !!r.panError).toBe(true);
  });
});
