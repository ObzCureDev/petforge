import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const originalPlatform = process.platform;

afterAll(() => {
  Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
});

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

// The platform tests above call `vi.resetModules()`, which invalidates any
// statically-imported namespace reference to `../src/core/service/index.js`.
// We re-import the module fresh in `beforeAll` so `vi.spyOn(svcMod, ...)` below
// actually intercepts the binding that `src/commands/service.ts` will resolve.
import type { ServiceManager } from "../src/core/service/index.js";

let svcMod: typeof import("../src/core/service/index.js");

describe("serviceCli", () => {
  beforeAll(async () => {
    Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
    vi.resetModules();
    svcMod = await import("../src/core/service/index.js");
  });

  afterEach(() => vi.restoreAllMocks());

  it("forwards --lan and --port=8000 as upArgs to install", async () => {
    const fakeMgr = {
      install: vi.fn().mockResolvedValue({ status: "installed", manifestPath: "/tmp/x", hint: "" }),
      uninstall: vi.fn(),
      status: vi.fn(),
    };
    vi.spyOn(svcMod, "getServiceManager").mockReturnValue(fakeMgr as unknown as ServiceManager);
    const { serviceCli } = await import("../src/commands/service.js");
    const code = await serviceCli(["install", "--lan", "--port=8000"]);
    expect(code).toBe(0);
    expect(fakeMgr.install).toHaveBeenCalledWith({
      upArgs: ["--lan", "--port=8000"],
      name: undefined,
    });
  });

  it("extracts --name= and forwards the rest", async () => {
    const fakeMgr = {
      install: vi.fn().mockResolvedValue({ status: "installed", manifestPath: "/tmp/x", hint: "" }),
      uninstall: vi.fn(),
      status: vi.fn(),
    };
    vi.spyOn(svcMod, "getServiceManager").mockReturnValue(fakeMgr as unknown as ServiceManager);
    const { serviceCli } = await import("../src/commands/service.js");
    const code = await serviceCli(["install", "--name=custom", "--lan"]);
    expect(code).toBe(0);
    expect(fakeMgr.install).toHaveBeenCalledWith({ upArgs: ["--lan"], name: "custom" });
  });

  it("'status' prints not-installed and exits 0 when nothing is installed", async () => {
    const fakeMgr = {
      install: vi.fn(),
      uninstall: vi.fn(),
      status: vi.fn().mockResolvedValue({ state: "not-installed", manifestPath: null }),
    };
    vi.spyOn(svcMod, "getServiceManager").mockReturnValue(fakeMgr as unknown as ServiceManager);
    const { serviceCli } = await import("../src/commands/service.js");
    const writeMock = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const code = await serviceCli(["status"]);
    expect(code).toBe(0);
    const printed = writeMock.mock.calls.map((c) => c[0] as string).join("");
    expect(printed).toMatch(/not-installed/i);
  });

  it("'uninstall' exits 0 even when nothing was installed", async () => {
    const fakeMgr = {
      install: vi.fn(),
      uninstall: vi.fn().mockResolvedValue({ status: "not-installed" }),
      status: vi.fn(),
    };
    vi.spyOn(svcMod, "getServiceManager").mockReturnValue(fakeMgr as unknown as ServiceManager);
    const { serviceCli } = await import("../src/commands/service.js");
    const code = await serviceCli(["uninstall"]);
    expect(code).toBe(0);
  });

  it("returns 1 with usage on unknown subcommand", async () => {
    const { serviceCli } = await import("../src/commands/service.js");
    const writeMock = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const code = await serviceCli(["foo"]);
    expect(code).toBe(1);
    const printed = writeMock.mock.calls.map((c) => c[0] as string).join("");
    expect(printed).toMatch(/Usage:\s+petforge service/);
  });

  it("--help prints usage and exits 0", async () => {
    const { serviceCli } = await import("../src/commands/service.js");
    const writeMock = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const code = await serviceCli(["--help"]);
    expect(code).toBe(0);
    const printed = writeMock.mock.calls.map((c) => c[0] as string).join("");
    expect(printed).toMatch(/Usage:\s+petforge service/);
  });
});
