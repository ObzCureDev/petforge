import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, it } from "vitest";
import { createInitialQuota } from "../../src/core/quota/schema.js";
import { QuotaBlock } from "../../src/render/components/QuotaBlock.js";

describe("QuotaBlock", () => {
  it("renders nothing when quota is undefined", () => {
    const { lastFrame } = render(React.createElement(QuotaBlock, { quota: undefined }));
    expect(lastFrame()).toBe("");
  });

  it("renders nothing when opt-out", () => {
    const { lastFrame } = render(React.createElement(QuotaBlock, { quota: createInitialQuota(0) }));
    expect(lastFrame()).toBe("");
  });

  it("renders 5h bar when opt-in with session data", () => {
    const q = createInitialQuota(0);
    q.optIn = true;
    q.lastProbeOk = true;
    q.session5h = { utilization: 59, resetTs: Math.floor(Date.now() / 1000) + 3 * 3600 };
    const { lastFrame } = render(React.createElement(QuotaBlock, { quota: q }));
    const out = lastFrame() ?? "";
    expect(out).toContain("QUOTAS");
    expect(out).toContain("5h");
    expect(out).toMatch(/59\s*%/);
  });

  it("renders 7d bar only when weekly7d is present", () => {
    const q = createInitialQuota(0);
    q.optIn = true;
    q.lastProbeOk = true;
    q.session5h = { utilization: 10, resetTs: 0 };
    const { lastFrame } = render(React.createElement(QuotaBlock, { quota: q }));
    expect(lastFrame() ?? "").not.toContain("7d");

    q.weekly7d = { utilization: 20, resetTs: 0 };
    const { lastFrame: f2 } = render(React.createElement(QuotaBlock, { quota: q }));
    expect(f2() ?? "").toContain("7d");
  });
});
