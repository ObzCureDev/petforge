import { describe, expect, it } from "vitest";
import { deriveQuotaMood } from "../../../src/core/quota/mood.js";
import { createInitialQuota } from "../../../src/core/quota/schema.js";

function withWindow(util: number) {
  const q = createInitialQuota(0);
  q.optIn = true;
  q.lastProbeOk = true;
  q.session5h = { utilization: util, resetTs: 0 };
  q.status = "allowed";
  return q;
}

describe("quota/mood", () => {
  it("returns calm when opt-out", () => {
    const q = createInitialQuota(0);
    expect(deriveQuotaMood(q)).toBe("calm");
  });

  it("returns calm when probe failed (no signal)", () => {
    const q = withWindow(99);
    q.lastProbeOk = false;
    expect(deriveQuotaMood(q)).toBe("calm");
  });

  it("returns calm when session5h is null", () => {
    const q = withWindow(0);
    q.session5h = null;
    expect(deriveQuotaMood(q)).toBe("calm");
  });

  it("returns calm below stressed threshold", () => {
    expect(deriveQuotaMood(withWindow(79))).toBe("calm");
  });

  it("returns stressed at 80% utilization", () => {
    expect(deriveQuotaMood(withWindow(80))).toBe("stressed");
  });

  it("returns stressed when status is allowed_warning even at 0% util", () => {
    const q = withWindow(10);
    q.status = "allowed_warning";
    expect(deriveQuotaMood(q)).toBe("stressed");
  });

  it("returns panic at 95% utilization", () => {
    expect(deriveQuotaMood(withWindow(95))).toBe("panic");
  });

  it("returns panic when status is denied", () => {
    const q = withWindow(10);
    q.status = "denied";
    expect(deriveQuotaMood(q)).toBe("panic");
  });
});
