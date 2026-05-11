import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as macMod from "../src/core/service/macos.js";
import { buildLaunchAgentPlist } from "../src/core/service/macos.js";

describe("buildLaunchAgentPlist", () => {
  const baseInput = {
    label: "com.mindvisionstudio.petforge",
    nodeExe: "/usr/local/bin/node",
    entryScript: "/Users/dan/.npm-global/lib/node_modules/@mindvisionstudio/petforge/dist/index.js",
    upArgs: ["up", "--lan"],
    workingDirectory: "/Users/dan/.npm-global/lib/node_modules/@mindvisionstudio/petforge",
    logDir: "/Users/dan/.petforge/logs",
  };

  it("contains the label", () => {
    const plist = buildLaunchAgentPlist(baseInput);
    expect(plist).toContain("<key>Label</key>");
    expect(plist).toContain("<string>com.mindvisionstudio.petforge</string>");
  });

  it("contains node + entry + up args as a ProgramArguments array", () => {
    const plist = buildLaunchAgentPlist(baseInput);
    expect(plist).toContain("<key>ProgramArguments</key>");
    const programIdx = plist.indexOf("ProgramArguments");
    const nodeIdx = plist.indexOf(baseInput.nodeExe, programIdx);
    const entryIdx = plist.indexOf(baseInput.entryScript, programIdx);
    const lanIdx = plist.indexOf("--lan", programIdx);
    expect(nodeIdx).toBeGreaterThan(programIdx);
    expect(entryIdx).toBeGreaterThan(nodeIdx);
    expect(lanIdx).toBeGreaterThan(entryIdx);
  });

  it("enables RunAtLoad and KeepAlive (auto-restart on crash)", () => {
    const plist = buildLaunchAgentPlist(baseInput);
    expect(plist).toMatch(/<key>RunAtLoad<\/key>\s*<true\/>/);
    expect(plist).toMatch(/<key>KeepAlive<\/key>\s*<true\/>/);
  });

  it("redirects stdout and stderr into the log directory", () => {
    const plist = buildLaunchAgentPlist(baseInput);
    expect(plist).toContain("<key>StandardOutPath</key>");
    expect(plist).toContain("/Users/dan/.petforge/logs/out.log");
    expect(plist).toContain("<key>StandardErrorPath</key>");
    expect(plist).toContain("/Users/dan/.petforge/logs/err.log");
  });

  it("escapes XML metacharacters in args (regression: --token=a&b)", () => {
    const plist = buildLaunchAgentPlist({ ...baseInput, upArgs: ["up", "--token=a&b"] });
    expect(plist).toContain("--token=a&amp;b");
    expect(plist).not.toContain("--token=a&b<");
  });
});

describe("MacOSServiceManager.install", () => {
  let runSpy: ReturnType<typeof vi.spyOn>;
  let writeSpy: ReturnType<typeof vi.spyOn>;
  let existsSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    runSpy = vi
      .spyOn(macMod.exec, "runCommand")
      .mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
    writeSpy = vi.spyOn(macMod.exec, "writePlist").mockResolvedValue(undefined);
    existsSpy = vi.spyOn(macMod.exec, "fileExists").mockResolvedValue(false);
  });

  afterEach(() => {
    runSpy.mockRestore();
    writeSpy.mockRestore();
    existsSpy.mockRestore();
  });

  it("writes the plist to ~/Library/LaunchAgents and runs launchctl bootstrap", async () => {
    const mgr = new macMod.MacOSServiceManager();
    const r = await mgr.install({ upArgs: ["--lan"] });
    expect(writeSpy).toHaveBeenCalledTimes(1);
    const [target] = writeSpy.mock.calls[0] as [string, string];
    expect(target).toMatch(/Library[\\/]LaunchAgents[\\/]com\.mindvisionstudio\.petforge\.plist$/);
    const cmds = runSpy.mock.calls.map(
      ([cmd, args]: [string, string[]]) => `${cmd} ${args.join(" ")}`,
    );
    expect(cmds.some((c: string) => c.startsWith("launchctl bootstrap gui/"))).toBe(true);
    expect(r.manifestPath).toMatch(/com\.mindvisionstudio\.petforge\.plist$/);
    expect(r.status).toMatch(/installed|updated/);
  });

  it("falls back to `launchctl load -w` when bootstrap returns non-zero", async () => {
    runSpy.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[0] === "bootstrap") return { exitCode: 5, stdout: "", stderr: "Unrecognized" };
      return { exitCode: 0, stdout: "", stderr: "" };
    });
    const mgr = new macMod.MacOSServiceManager();
    await mgr.install({ upArgs: [] });
    const cmds = runSpy.mock.calls.map(
      ([cmd, args]: [string, string[]]) => `${cmd} ${args.join(" ")}`,
    );
    expect(cmds.some((c: string) => c.startsWith("launchctl load -w "))).toBe(true);
  });

  it("calls bootout before bootstrap when the plist already exists (update)", async () => {
    existsSpy.mockResolvedValue(true);
    const mgr = new macMod.MacOSServiceManager();
    const r = await mgr.install({ upArgs: [] });
    expect(r.status).toBe("updated");
    const cmds = runSpy.mock.calls.map(
      ([cmd, args]: [string, string[]]) => `${cmd} ${args.join(" ")}`,
    );
    const bootoutIdx = cmds.findIndex((c: string) => c.startsWith("launchctl bootout gui/"));
    const bootstrapIdx = cmds.findIndex((c: string) => c.startsWith("launchctl bootstrap gui/"));
    expect(bootoutIdx).toBeGreaterThan(-1);
    expect(bootstrapIdx).toBeGreaterThan(bootoutIdx);
  });
});

describe("MacOSServiceManager.status", () => {
  afterEach(() => vi.restoreAllMocks());

  it("reports not-installed when no plist exists", async () => {
    vi.spyOn(macMod.exec, "fileExists").mockResolvedValue(false);
    const mgr = new macMod.MacOSServiceManager();
    const s = await mgr.status();
    expect(s.state).toBe("not-installed");
    expect(s.manifestPath).toBeNull();
  });

  it("reports installed-running when launchctl print shows state = running", async () => {
    vi.spyOn(macMod.exec, "fileExists").mockResolvedValue(true);
    vi.spyOn(macMod.exec, "runCommand").mockResolvedValue({
      exitCode: 0,
      stdout: "state = running\n",
      stderr: "",
    });
    const mgr = new macMod.MacOSServiceManager();
    const s = await mgr.status();
    expect(s.state).toBe("installed-running");
  });

  it("reports installed-stopped when launchctl print shows state = not running", async () => {
    vi.spyOn(macMod.exec, "fileExists").mockResolvedValue(true);
    vi.spyOn(macMod.exec, "runCommand").mockResolvedValue({
      exitCode: 0,
      stdout: "state = not running\n",
      stderr: "",
    });
    const mgr = new macMod.MacOSServiceManager();
    const s = await mgr.status();
    expect(s.state).toBe("installed-stopped");
  });
});

describe("MacOSServiceManager.uninstall", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns not-installed when no plist exists", async () => {
    vi.spyOn(macMod.exec, "fileExists").mockResolvedValue(false);
    const mgr = new macMod.MacOSServiceManager();
    const r = await mgr.uninstall();
    expect(r.status).toBe("not-installed");
  });

  it("removes the plist file and runs launchctl bootout", async () => {
    vi.spyOn(macMod.exec, "fileExists").mockResolvedValue(true);
    const runSpy = vi
      .spyOn(macMod.exec, "runCommand")
      .mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
    const rmSpy = vi.spyOn(macMod.exec, "removeFile").mockResolvedValue(undefined);
    const mgr = new macMod.MacOSServiceManager();
    const r = await mgr.uninstall();
    expect(r.status).toBe("uninstalled");
    expect(rmSpy).toHaveBeenCalled();
    const cmds = runSpy.mock.calls.map(
      ([cmd, args]: [string, string[]]) => `${cmd} ${args.join(" ")}`,
    );
    expect(cmds.some((c: string) => c.startsWith("launchctl bootout gui/"))).toBe(true);
  });
});
