import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as linMod from "../src/core/service/linux.js";
import { buildSystemdUserUnit } from "../src/core/service/linux.js";

describe("buildSystemdUserUnit", () => {
  const baseInput = {
    description: "PetForge auto-start",
    nodeExe: "/usr/bin/node",
    entryScript: "/home/dan/.npm-global/lib/node_modules/@mindvisionstudio/petforge/dist/index.js",
    upArgs: ["up", "--lan"],
    workingDirectory: "/home/dan/.npm-global/lib/node_modules/@mindvisionstudio/petforge",
  };

  it("starts with [Unit] section and a Description", () => {
    const unit = buildSystemdUserUnit(baseInput);
    expect(unit).toMatch(/^\[Unit\]\s*\nDescription=PetForge auto-start/);
  });

  it("ExecStart wraps node, then the entry script in double quotes, then up args", () => {
    const unit = buildSystemdUserUnit(baseInput);
    expect(unit).toContain(`ExecStart=/usr/bin/node "${baseInput.entryScript}" up --lan`);
  });

  it("installs into default.target so it auto-starts on session", () => {
    const unit = buildSystemdUserUnit(baseInput);
    expect(unit).toMatch(/\[Install\][\s\S]*WantedBy=default\.target/);
  });

  it("uses Restart=on-failure with RestartSec=3", () => {
    const unit = buildSystemdUserUnit(baseInput);
    expect(unit).toContain("Restart=on-failure");
    expect(unit).toContain("RestartSec=3");
  });
});

describe("LinuxServiceManager.install", () => {
  let runSpy: ReturnType<typeof vi.spyOn>;
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    runSpy = vi
      .spyOn(linMod.exec, "runCommand")
      .mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
    writeSpy = vi.spyOn(linMod.exec, "writeUnit").mockResolvedValue(undefined);
    vi.spyOn(linMod.exec, "fileExists").mockResolvedValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes the unit to ~/.config/systemd/user and enables it", async () => {
    const mgr = new linMod.LinuxServiceManager();
    const r = await mgr.install({ upArgs: ["--lan"] });
    const [target] = writeSpy.mock.calls[0] as [string, string];
    expect(target).toMatch(/\.config[\\/]systemd[\\/]user[\\/]petforge\.service$/);
    const cmds = runSpy.mock.calls.map(
      ([cmd, args]: [string, string[]]) => `${cmd} ${args.join(" ")}`,
    );
    expect(cmds).toEqual(
      expect.arrayContaining([
        "systemctl --user daemon-reload",
        "systemctl --user enable --now petforge.service",
      ]),
    );
    expect(r.hint).toContain("loginctl enable-linger");
  });

  it("throws a friendly error if systemctl --user is unavailable", async () => {
    runSpy.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[0] === "--user" && args[1] === "daemon-reload") {
        return {
          exitCode: 1,
          stdout: "",
          stderr: "Failed to connect to bus: No such file or directory",
        };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    });
    const mgr = new linMod.LinuxServiceManager();
    await expect(mgr.install({ upArgs: [] })).rejects.toThrow(/systemd user instance/i);
  });
});

describe("LinuxServiceManager.status", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns not-installed when the unit file is missing", async () => {
    vi.spyOn(linMod.exec, "fileExists").mockResolvedValue(false);
    const s = await new linMod.LinuxServiceManager().status();
    expect(s.state).toBe("not-installed");
  });

  it("returns installed-running when systemctl is-active prints 'active'", async () => {
    vi.spyOn(linMod.exec, "fileExists").mockResolvedValue(true);
    vi.spyOn(linMod.exec, "runCommand").mockResolvedValue({
      exitCode: 0,
      stdout: "active\n",
      stderr: "",
    });
    const s = await new linMod.LinuxServiceManager().status();
    expect(s.state).toBe("installed-running");
  });

  it("returns installed-stopped when systemctl is-active prints 'inactive'", async () => {
    vi.spyOn(linMod.exec, "fileExists").mockResolvedValue(true);
    vi.spyOn(linMod.exec, "runCommand").mockResolvedValue({
      exitCode: 3,
      stdout: "inactive\n",
      stderr: "",
    });
    const s = await new linMod.LinuxServiceManager().status();
    expect(s.state).toBe("installed-stopped");
  });
});

describe("LinuxServiceManager.uninstall", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns not-installed when the unit file is missing", async () => {
    vi.spyOn(linMod.exec, "fileExists").mockResolvedValue(false);
    const r = await new linMod.LinuxServiceManager().uninstall();
    expect(r.status).toBe("not-installed");
  });

  it("disables and stops the unit, then removes the file", async () => {
    vi.spyOn(linMod.exec, "fileExists").mockResolvedValue(true);
    const runSpy = vi
      .spyOn(linMod.exec, "runCommand")
      .mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
    const rmSpy = vi.spyOn(linMod.exec, "removeFile").mockResolvedValue(undefined);
    const r = await new linMod.LinuxServiceManager().uninstall();
    expect(r.status).toBe("uninstalled");
    const cmds = runSpy.mock.calls.map(
      ([cmd, args]: [string, string[]]) => `${cmd} ${args.join(" ")}`,
    );
    expect(cmds.some((c) => c.includes("disable --now petforge.service"))).toBe(true);
    expect(rmSpy).toHaveBeenCalled();
  });
});
