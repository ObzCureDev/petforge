import { describe, expect, it, vi } from "vitest";

describe("getServiceManager", () => {
  it("returns the Windows manager on win32", async () => {
    vi.resetModules();
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
    const { getServiceManager } = await import("../src/core/service/index.js");
    const mgr = getServiceManager();
    expect(mgr.constructor.name).toBe("WindowsServiceManager");
  });

  it("returns the macOS manager on darwin", async () => {
    vi.resetModules();
    Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
    const { getServiceManager } = await import("../src/core/service/index.js");
    const mgr = getServiceManager();
    expect(mgr.constructor.name).toBe("MacOSServiceManager");
  });

  it("returns the Linux manager on linux", async () => {
    vi.resetModules();
    Object.defineProperty(process, "platform", { value: "linux", configurable: true });
    const { getServiceManager } = await import("../src/core/service/index.js");
    const mgr = getServiceManager();
    expect(mgr.constructor.name).toBe("LinuxServiceManager");
  });

  it("throws on unsupported platforms", async () => {
    vi.resetModules();
    Object.defineProperty(process, "platform", { value: "aix", configurable: true });
    const { getServiceManager } = await import("../src/core/service/index.js");
    expect(() => getServiceManager()).toThrow(/unsupported platform/i);
  });
});
