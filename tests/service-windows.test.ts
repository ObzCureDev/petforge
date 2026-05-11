import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as winMod from "../src/core/service/windows.js";
import { buildScheduledTaskXml } from "../src/core/service/windows.js";

describe("buildScheduledTaskXml", () => {
  const baseInput = {
    description: "PetForge auto-start (user logon)",
    userId: "DAN-PC\\dan",
    nodeExe: "C:\\Program Files\\nodejs\\node.exe",
    entryScript:
      "C:\\Users\\dan\\AppData\\Roaming\\npm\\node_modules\\@mindvisionstudio\\petforge\\dist\\index.js",
    upArgs: ["up", "--lan"],
    workingDirectory:
      "C:\\Users\\dan\\AppData\\Roaming\\npm\\node_modules\\@mindvisionstudio\\petforge",
  };

  it("contains a LogonTrigger and AtLogon trigger type", () => {
    const xml = buildScheduledTaskXml(baseInput);
    expect(xml).toContain("<LogonTrigger>");
    expect(xml).toContain("<Enabled>true</Enabled>");
  });

  it("embeds the node executable in <Command>", () => {
    const xml = buildScheduledTaskXml(baseInput);
    expect(xml).toContain("<Command>C:\\Program Files\\nodejs\\node.exe</Command>");
  });

  it("embeds the up args after the entry script in <Arguments>", () => {
    const xml = buildScheduledTaskXml(baseInput);
    expect(xml).toMatch(
      /<Arguments>"C:\\Users\\dan\\AppData\\Roaming\\npm\\node_modules\\@mindvisionstudio\\petforge\\dist\\index\.js" up --lan<\/Arguments>/,
    );
  });

  it("uses InteractiveToken so no password is required", () => {
    const xml = buildScheduledTaskXml(baseInput);
    expect(xml).toContain("<LogonType>InteractiveToken</LogonType>");
  });

  it("sets ExecutionTimeLimit to PT0S (no timeout)", () => {
    const xml = buildScheduledTaskXml(baseInput);
    expect(xml).toContain("<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>");
  });

  it("escapes XML metacharacters in the description", () => {
    const xml = buildScheduledTaskXml({ ...baseInput, description: '<bad> & "quoted"' });
    expect(xml).toContain("&lt;bad&gt; &amp; &quot;quoted&quot;");
  });

  it("does not run if on batteries by default", () => {
    const xml = buildScheduledTaskXml(baseInput);
    expect(xml).toContain("<DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>");
    expect(xml).toContain("<StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>");
  });

  it("escapes XML metacharacters in upArgs (regression: --token=a&b must not break the manifest)", () => {
    const xml = buildScheduledTaskXml({ ...baseInput, upArgs: ["up", "--token=a&b"] });
    expect(xml).toContain("--token=a&amp;b");
    expect(xml).not.toContain("--token=a&b<");
  });
});

describe("WindowsServiceManager.install", () => {
  let runSpy: ReturnType<typeof vi.spyOn>;
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    runSpy = vi
      .spyOn(winMod.exec, "runCommand")
      .mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
    writeSpy = vi.spyOn(winMod.exec, "writeManifest").mockResolvedValue(undefined);
  });

  afterEach(() => {
    runSpy.mockRestore();
    writeSpy.mockRestore();
  });

  it("writes the XML manifest then calls schtasks /Create", async () => {
    const mgr = new winMod.WindowsServiceManager();
    const result = await mgr.install({ upArgs: ["--lan"] });
    expect(writeSpy).toHaveBeenCalledTimes(1);
    // Find the schtasks /Create call (status() also uses runCommand, so multiple calls).
    const createCall = runSpy.mock.calls.find(([_cmd, args]: [string, string[]]) =>
      args.includes("/Create"),
    );
    expect(createCall).toBeDefined();
    const [cmd, args] = createCall as [string, string[]];
    expect(cmd).toBe("schtasks.exe");
    expect(args).toContain("/Create");
    expect(args).toContain("/TN");
    expect(args).toContain("PetForge");
    expect(args).toContain("/XML");
    expect(args).toContain("/F");
    expect(result.status).toMatch(/installed|updated/);
    expect(result.manifestPath).toMatch(/petforge.*\.xml$/i);
  });

  it("reports status='updated' when the task already exists", async () => {
    runSpy.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args.includes("/Query")) {
        return { exitCode: 0, stdout: "PetForge\tReady", stderr: "" };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    });
    const mgr = new winMod.WindowsServiceManager();
    const result = await mgr.install({ upArgs: [] });
    expect(result.status).toBe("updated");
  });
});

describe("WindowsServiceManager.status", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns 'not-installed' when schtasks /Query exits non-zero", async () => {
    vi.spyOn(winMod.exec, "runCommand").mockResolvedValue({
      exitCode: 1,
      stdout: "",
      stderr: "ERROR: The system cannot find the file specified.",
    });
    const mgr = new winMod.WindowsServiceManager();
    const s = await mgr.status();
    expect(s.state).toBe("not-installed");
    expect(s.manifestPath).toBeNull();
  });

  it("returns 'installed-running' when status output shows Running", async () => {
    vi.spyOn(winMod.exec, "runCommand").mockResolvedValue({
      exitCode: 0,
      stdout: "Status: Running\nLast Result: 0x41303",
      stderr: "",
    });
    const mgr = new winMod.WindowsServiceManager();
    const s = await mgr.status();
    expect(s.state).toBe("installed-running");
  });

  it("returns 'installed-stopped' when status output shows Ready", async () => {
    vi.spyOn(winMod.exec, "runCommand").mockResolvedValue({
      exitCode: 0,
      stdout: "Status: Ready\nLast Result: 0x0",
      stderr: "",
    });
    const mgr = new winMod.WindowsServiceManager();
    const s = await mgr.status();
    expect(s.state).toBe("installed-stopped");
  });
});

describe("WindowsServiceManager.uninstall", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns 'not-installed' when the task doesn't exist", async () => {
    vi.spyOn(winMod.exec, "runCommand").mockResolvedValue({
      exitCode: 1,
      stdout: "",
      stderr: "ERROR: The system cannot find the file specified.",
    });
    const mgr = new winMod.WindowsServiceManager();
    const r = await mgr.uninstall();
    expect(r.status).toBe("not-installed");
  });

  it("calls schtasks /Delete /F when the task exists", async () => {
    const runSpy = vi
      .spyOn(winMod.exec, "runCommand")
      .mockImplementation(async (_cmd: string, args: string[]) => {
        if (args.includes("/Query")) return { exitCode: 0, stdout: "PetForge\tReady", stderr: "" };
        return { exitCode: 0, stdout: "", stderr: "" };
      });
    const mgr = new winMod.WindowsServiceManager();
    const r = await mgr.uninstall();
    expect(r.status).toBe("uninstalled");
    expect(runSpy).toHaveBeenCalledWith("schtasks.exe", expect.arrayContaining(["/Delete", "/F"]));
  });
});
