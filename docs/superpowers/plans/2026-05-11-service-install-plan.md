# PetForge V3.6 — `service install` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `petforge service install | uninstall | status` so users get auto-start on boot/login across Windows, macOS, and Linux without remembering to launch `petforge up --lan` themselves.

**Architecture:** One new CLI subcommand (`service`) dispatching to a platform-specific `ServiceManager` implementation. User-mode by default on every OS: Scheduled Task at logon on Windows (no admin), LaunchAgent in `~/Library/LaunchAgents/` on macOS, systemd `--user` unit on Linux. Each platform implementation exposes a tiny interface (`install`, `uninstall`, `status`); the CLI is just thin glue. Manifest generation (XML / plist / INI) lives in pure functions so all the meaningful logic is unit-testable without spawning real processes.

**Tech Stack:** TypeScript strict, Vitest, Biome, ESM, Node 20+. No new dependencies — we only call platform tools that already exist (`schtasks.exe`, `wscript.exe`, `launchctl`, `systemctl --user`).

**Out of scope for V3.6 (deferred):**
- System-mode install on Windows (admin / NSSM) — keep user-mode only. Document the LocalSystem `os.homedir()` gotcha so a future `--system` knows to inject `PETFORGE_HOME`.
- `loginctl enable-linger` automation on Linux (needs root) — print a hint, do not run it.
- Service logs viewer — point users at the native OS tooling.

---

## Why this matters & failure modes to anticipate

1. **Path with spaces (Windows):** When this plan was specced, the author hit `Cannot find module 'C:\Users\Dan'` because NSSM quoted a path argument badly. On Windows we will use the **junction-free path** when available (Windows creates `C:\Users\<displayname>` as a reparse point to `C:\Users\<accountname>`). Code that builds Scheduled Task XML must wrap every path in `"..."` and escape XML metachars.
2. **`os.homedir()` under LocalSystem:** Not a concern for V3.6 (user-mode only), but if a future `--system` lands it must inject `PETFORGE_HOME`, `USERPROFILE`, and `HOME` env vars so petforge reads/writes the right `.petforge/`.
3. **systemd not present on Linux:** Some distros (Alpine, NixOS w/o systemd, containers) don't run systemd. Detect and error cleanly.
4. **launchctl API shift:** macOS 10.10+ wants `launchctl bootstrap gui/$UID <plist>`; older `load -w` still works as a fallback. We will try `bootstrap` first and fall back to `load` only on error — both keep the user in user-domain.
5. **Re-install:** Running `service install` twice in a row must be idempotent — overwrite the existing task/agent/unit silently. No `--force` flag in V3.6.

---

## File Structure (target end-state)

### Created
- `src/commands/service.ts` — CLI dispatch (`serviceCli(argv)` → install / uninstall / status).
- `src/core/service/types.ts` — shared interfaces (`ServiceManager`, `ServiceArgs`, `InstallResult`, etc.).
- `src/core/service/index.ts` — factory `getServiceManager()` that picks the implementation based on `process.platform`.
- `src/core/service/windows.ts` — Scheduled Task implementation + manifest builder.
- `src/core/service/macos.ts` — launchd LaunchAgent implementation + plist builder.
- `src/core/service/linux.ts` — systemd user unit implementation + unit-file builder.
- `tests/service-windows.test.ts`
- `tests/service-macos.test.ts`
- `tests/service-linux.test.ts`
- `tests/service-cli.test.ts`

### Modified
- `src/index.ts` — register the new `service` command and add help text.
- `src/commands/doctor.ts` — add a "service installed (optional)" warning-level check.
- `tests/doctor.test.ts` — adjust expected check count.
- `package.json` — bump version `3.5.4` → `3.6.0`.
- `README.md` — short section on "Auto-start" with one example per OS.
- `CHANGELOG.md` — `3.6.0` entry.

### Deleted
None.

---

## Shared types (referenced by every later task)

These go in `src/core/service/types.ts` and the rest of the plan refers to them by exact name:

```ts
export interface ServiceArgs {
  /** Flags forwarded verbatim to `petforge up`. Each string is one token, e.g. ["--lan", "--port=8000"]. */
  upArgs: string[];
  /** Override the default service name ("petforge"). Lower-case, no spaces. */
  name?: string;
}

export type ServiceState = "installed-running" | "installed-stopped" | "not-installed";

export interface InstallResult {
  status: "installed" | "updated";
  /** Filesystem path of the installed manifest (XML / plist / unit file). */
  manifestPath: string;
  /** Free-form hint for the user (e.g. linger note on Linux). Empty string if none. */
  hint: string;
}

export interface UninstallResult {
  status: "uninstalled" | "not-installed";
}

export interface StatusResult {
  state: ServiceState;
  /** Filesystem path of the manifest if installed, otherwise null. */
  manifestPath: string | null;
}

export interface ServiceManager {
  install(args: ServiceArgs): Promise<InstallResult>;
  uninstall(name?: string): Promise<UninstallResult>;
  status(name?: string): Promise<StatusResult>;
}
```

The default service name is the string literal `"petforge"`. Each impl is allowed to mangle this for OS conventions (e.g. macOS expects reverse-DNS — we use `com.mindvisionstudio.petforge`).

---

## Task 1: Shared types + platform detection

**Files:**
- Create: `src/core/service/types.ts`
- Create: `src/core/service/index.ts`
- Create: `tests/service-cli.test.ts` (only the platform-detection test in this task)

- [ ] **Step 1.1: Write failing platform-detection test**

Create `tests/service-cli.test.ts`:

```ts
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
```

- [ ] **Step 1.2: Run test, expect FAIL**

```bash
cd C:/Users/dan/Repo/petforge
npx vitest run tests/service-cli.test.ts
```

Expected: 4 failures, all "Cannot find module '../src/core/service/index.js'".

- [ ] **Step 1.3: Create `src/core/service/types.ts`**

Paste the exact contents from the "Shared types" section above.

- [ ] **Step 1.4: Create stub manager classes**

We need the three concrete class names for the platform-detection test to import. Each one is a stub that throws `"not yet implemented"` for all interface methods — they'll be filled in subsequent tasks. This keeps `getServiceManager()` working in isolation.

Create `src/core/service/windows.ts`:

```ts
import type { InstallResult, ServiceArgs, ServiceManager, StatusResult, UninstallResult } from "./types.js";

export class WindowsServiceManager implements ServiceManager {
  install(_args: ServiceArgs): Promise<InstallResult> {
    throw new Error("WindowsServiceManager.install: not yet implemented");
  }
  uninstall(_name?: string): Promise<UninstallResult> {
    throw new Error("WindowsServiceManager.uninstall: not yet implemented");
  }
  status(_name?: string): Promise<StatusResult> {
    throw new Error("WindowsServiceManager.status: not yet implemented");
  }
}
```

Create `src/core/service/macos.ts` and `src/core/service/linux.ts` with the same shape (replace the class name with `MacOSServiceManager` / `LinuxServiceManager`).

- [ ] **Step 1.5: Create the factory**

Create `src/core/service/index.ts`:

```ts
import { LinuxServiceManager } from "./linux.js";
import { MacOSServiceManager } from "./macos.js";
import type { ServiceManager } from "./types.js";
import { WindowsServiceManager } from "./windows.js";

export type { InstallResult, ServiceArgs, ServiceManager, ServiceState, StatusResult, UninstallResult } from "./types.js";

export function getServiceManager(): ServiceManager {
  switch (process.platform) {
    case "win32":
      return new WindowsServiceManager();
    case "darwin":
      return new MacOSServiceManager();
    case "linux":
      return new LinuxServiceManager();
    default:
      throw new Error(`unsupported platform: ${process.platform}`);
  }
}
```

- [ ] **Step 1.6: Run test, expect PASS**

```bash
npx vitest run tests/service-cli.test.ts
```

Expected: 4 passing.

- [ ] **Step 1.7: Run typecheck**

```bash
npm run typecheck
```

Expected: exit 0, no errors.

- [ ] **Step 1.8: Commit**

```bash
git add src/core/service/ tests/service-cli.test.ts
git commit -m "feat(service): add platform-detection factory and types"
```

---

## Task 2: Windows manifest builder (pure function)

The Windows Scheduled Task is registered by handing `schtasks.exe` an XML manifest. Building that XML is the only piece of Windows-specific code that doesn't touch the filesystem or spawn anything, so we test it in isolation first.

**Files:**
- Modify: `src/core/service/windows.ts`
- Create/modify: `tests/service-windows.test.ts`

- [ ] **Step 2.1: Write failing manifest test**

Create `tests/service-windows.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildScheduledTaskXml } from "../src/core/service/windows.js";

describe("buildScheduledTaskXml", () => {
  const baseInput = {
    description: "PetForge auto-start (user logon)",
    userId: "DAN-PC\\dan",
    nodeExe: "C:\\Program Files\\nodejs\\node.exe",
    entryScript: "C:\\Users\\dan\\AppData\\Roaming\\npm\\node_modules\\@mindvisionstudio\\petforge\\dist\\index.js",
    upArgs: ["up", "--lan"],
    workingDirectory: "C:\\Users\\dan\\AppData\\Roaming\\npm\\node_modules\\@mindvisionstudio\\petforge",
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
    // Arguments token: "<entry>" up --lan
    expect(xml).toMatch(/<Arguments>"C:\\Users\\dan\\AppData\\Roaming\\npm\\node_modules\\@mindvisionstudio\\petforge\\dist\\index\.js" up --lan<\/Arguments>/);
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
    const xml = buildScheduledTaskXml({ ...baseInput, description: "<bad> & \"quoted\"" });
    expect(xml).toContain("&lt;bad&gt; &amp; &quot;quoted&quot;");
  });

  it("does not run if on batteries by default", () => {
    const xml = buildScheduledTaskXml(baseInput);
    expect(xml).toContain("<DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>");
    expect(xml).toContain("<StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>");
  });
});
```

- [ ] **Step 2.2: Run test, expect FAIL**

```bash
npx vitest run tests/service-windows.test.ts
```

Expected: 7 failures, all "buildScheduledTaskXml is not a function" (or the import error).

- [ ] **Step 2.3: Implement `buildScheduledTaskXml`**

Replace `src/core/service/windows.ts` with:

```ts
import type { InstallResult, ServiceArgs, ServiceManager, StatusResult, UninstallResult } from "./types.js";

export interface ScheduledTaskInput {
  description: string;
  userId: string;
  nodeExe: string;
  entryScript: string;
  upArgs: string[];
  workingDirectory: string;
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function buildScheduledTaskXml(i: ScheduledTaskInput): string {
  const argString = [`"${xmlEscape(i.entryScript)}"`, ...i.upArgs.map(xmlEscape)].join(" ");
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>${xmlEscape(i.description)}</Description>
    <URI>\\PetForge</URI>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <UserId>${xmlEscape(i.userId)}</UserId>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>${xmlEscape(i.userId)}</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>true</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${xmlEscape(i.nodeExe)}</Command>
      <Arguments>${argString}</Arguments>
      <WorkingDirectory>${xmlEscape(i.workingDirectory)}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>`;
}

export class WindowsServiceManager implements ServiceManager {
  install(_args: ServiceArgs): Promise<InstallResult> {
    throw new Error("WindowsServiceManager.install: not yet implemented");
  }
  uninstall(_name?: string): Promise<UninstallResult> {
    throw new Error("WindowsServiceManager.uninstall: not yet implemented");
  }
  status(_name?: string): Promise<StatusResult> {
    throw new Error("WindowsServiceManager.status: not yet implemented");
  }
}
```

Note: keep the `Command` element raw (no quoting) — Task Scheduler treats it as a plain path. Arguments get the entry-script quoted because Task Scheduler joins the field with a space and the script path can contain spaces.

- [ ] **Step 2.4: Run test, expect PASS**

```bash
npx vitest run tests/service-windows.test.ts
```

Expected: 7 passing.

- [ ] **Step 2.5: Run typecheck + lint**

```bash
npm run typecheck && npm run check
```

Expected: exit 0.

- [ ] **Step 2.6: Commit**

```bash
git add src/core/service/windows.ts tests/service-windows.test.ts
git commit -m "feat(service): Windows Scheduled Task XML builder"
```

---

## Task 3: WindowsServiceManager — install/uninstall/status

This is the first task that touches the filesystem and calls `schtasks.exe`. To keep it testable, every external side effect goes through one of two narrow shims:

- `runCommand(cmd, args)` — wraps `execFile` (from `node:child_process`), returns `{exitCode, stdout, stderr}`.
- `writeManifest(path, contents)` — wraps `fs.writeFile` with UTF-16 LE encoding (Task Scheduler requires it for XML).

Both are exported from the module so tests can mock them with `vi.spyOn`.

**Files:**
- Modify: `src/core/service/windows.ts`
- Modify: `tests/service-windows.test.ts`

- [ ] **Step 3.1: Write failing install test**

Append to `tests/service-windows.test.ts`:

```ts
import { afterEach, beforeEach, vi } from "vitest";
import * as winMod from "../src/core/service/windows.js";

describe("WindowsServiceManager.install", () => {
  let runSpy: ReturnType<typeof vi.spyOn>;
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    runSpy = vi.spyOn(winMod, "runCommand").mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
    writeSpy = vi.spyOn(winMod, "writeManifest").mockResolvedValue();
  });

  afterEach(() => {
    runSpy.mockRestore();
    writeSpy.mockRestore();
  });

  it("writes the XML manifest then calls schtasks /Create", async () => {
    const mgr = new winMod.WindowsServiceManager();
    const result = await mgr.install({ upArgs: ["--lan"] });
    expect(writeSpy).toHaveBeenCalledTimes(1);
    expect(runSpy).toHaveBeenCalledTimes(1);
    const [cmd, args] = runSpy.mock.calls[0];
    expect(cmd).toBe("schtasks.exe");
    expect(args).toContain("/Create");
    expect(args).toContain("/TN");
    expect(args).toContain("PetForge");
    expect(args).toContain("/XML");
    expect(args).toContain("/F"); // force overwrite — idempotency
    expect(result.status).toMatch(/installed|updated/);
    expect(result.manifestPath).toMatch(/petforge.*\.xml$/i);
  });

  it("reports status='updated' when the task already exists", async () => {
    // First call: status reports installed, then install treats as update.
    runSpy.mockImplementation(async (cmd: string, args: string[]) => {
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
  it("returns 'not-installed' when schtasks /Query exits non-zero", async () => {
    const runSpy = vi.spyOn(winMod, "runCommand").mockResolvedValue({
      exitCode: 1,
      stdout: "",
      stderr: "ERROR: The system cannot find the file specified.",
    });
    const mgr = new winMod.WindowsServiceManager();
    const s = await mgr.status();
    expect(s.state).toBe("not-installed");
    expect(s.manifestPath).toBeNull();
    runSpy.mockRestore();
  });

  it("returns 'installed-running' when Last Run Result is 0x41303 (Running)", async () => {
    const runSpy = vi.spyOn(winMod, "runCommand").mockResolvedValue({
      exitCode: 0,
      stdout: "Status: Running\nLast Result: 0x41303",
      stderr: "",
    });
    const mgr = new winMod.WindowsServiceManager();
    const s = await mgr.status();
    expect(s.state).toBe("installed-running");
    runSpy.mockRestore();
  });
});

describe("WindowsServiceManager.uninstall", () => {
  it("returns 'not-installed' when the task doesn't exist", async () => {
    const runSpy = vi.spyOn(winMod, "runCommand").mockResolvedValue({
      exitCode: 1,
      stdout: "",
      stderr: "ERROR: The system cannot find the file specified.",
    });
    const mgr = new winMod.WindowsServiceManager();
    const r = await mgr.uninstall();
    expect(r.status).toBe("not-installed");
    runSpy.mockRestore();
  });

  it("calls schtasks /Delete /F when the task exists", async () => {
    const runSpy = vi.spyOn(winMod, "runCommand").mockImplementation(async (cmd: string, args: string[]) => {
      if (args.includes("/Query")) return { exitCode: 0, stdout: "PetForge\tReady", stderr: "" };
      return { exitCode: 0, stdout: "", stderr: "" };
    });
    const mgr = new winMod.WindowsServiceManager();
    const r = await mgr.uninstall();
    expect(r.status).toBe("uninstalled");
    expect(runSpy).toHaveBeenCalledWith("schtasks.exe", expect.arrayContaining(["/Delete", "/F"]));
    runSpy.mockRestore();
  });
});
```

- [ ] **Step 3.2: Run test, expect FAIL**

```bash
npx vitest run tests/service-windows.test.ts
```

Expected: new tests all fail (`runCommand`/`writeManifest` not exported, methods throw "not yet implemented").

- [ ] **Step 3.3: Implement the manager**

Replace the entirety of `src/core/service/windows.ts` with:

```ts
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { InstallResult, ServiceArgs, ServiceManager, StatusResult, UninstallResult } from "./types.js";

const execFileP = promisify(execFile);

const TASK_NAME = "PetForge";

export interface ScheduledTaskInput {
  description: string;
  userId: string;
  nodeExe: string;
  entryScript: string;
  upArgs: string[];
  workingDirectory: string;
}

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function buildScheduledTaskXml(i: ScheduledTaskInput): string {
  // ... (paste the buildScheduledTaskXml body from Task 2 unchanged)
}

export async function runCommand(cmd: string, args: string[]): Promise<CommandResult> {
  try {
    const { stdout, stderr } = await execFileP(cmd, args, { windowsHide: true });
    return { exitCode: 0, stdout, stderr };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number };
    return {
      exitCode: typeof e.code === "number" ? e.code : 1,
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? e.message ?? "",
    };
  }
}

export async function writeManifest(target: string, contents: string): Promise<void> {
  // Task Scheduler requires UTF-16 LE with BOM for the XML manifest.
  const buf = Buffer.concat([
    Buffer.from([0xff, 0xfe]),
    Buffer.from(contents, "utf16le"),
  ]);
  await fs.writeFile(target, buf);
}

function detectNodeExe(): string {
  return process.execPath;
}

function detectEntryScript(): string {
  // src/core/service/windows.ts → dist/core/service/windows.js → dist/index.js
  // tsup bundles to dist/index.js, so we can compute the entry script as
  // sibling of the running module file when bundled, OR sibling of
  // process.argv[1] when running via the npm shim.
  // Simplest reliable approach: assume process.argv[1] is petforge's entry.
  return path.resolve(process.argv[1] ?? "");
}

function detectWorkingDirectory(entryScript: string): string {
  return path.dirname(path.dirname(entryScript)); // dist/index.js → dist → package root
}

function detectUserId(): string {
  // schtasks accepts DOMAIN\username. USERDOMAIN is set on real logons; fall back to hostname.
  const domain = process.env.USERDOMAIN ?? os.hostname();
  const user = process.env.USERNAME ?? os.userInfo().username;
  return `${domain}\\${user}`;
}

function manifestPath(): string {
  const dir = path.join(os.tmpdir(), "petforge-service");
  return path.join(dir, "task.xml");
}

export class WindowsServiceManager implements ServiceManager {
  async install(args: ServiceArgs): Promise<InstallResult> {
    const prev = await this.status(args.name);
    const wasInstalled = prev.state !== "not-installed";

    const entryScript = detectEntryScript();
    const nodeExe = detectNodeExe();
    const workingDirectory = detectWorkingDirectory(entryScript);
    const userId = detectUserId();
    const upArgs = ["up", ...args.upArgs];

    const xml = buildScheduledTaskXml({
      description: "PetForge auto-start (user logon)",
      userId,
      nodeExe,
      entryScript,
      upArgs,
      workingDirectory,
    });

    const target = manifestPath();
    await fs.mkdir(path.dirname(target), { recursive: true });
    await module.exports.writeManifest(target, xml);

    const result = await module.exports.runCommand("schtasks.exe", [
      "/Create",
      "/TN",
      args.name ?? TASK_NAME,
      "/XML",
      target,
      "/F",
    ]);
    if (result.exitCode !== 0) {
      throw new Error(`schtasks /Create failed: ${result.stderr.trim()}`);
    }
    return {
      status: wasInstalled ? "updated" : "installed",
      manifestPath: target,
      hint: "",
    };
  }

  async uninstall(name?: string): Promise<UninstallResult> {
    const s = await this.status(name);
    if (s.state === "not-installed") {
      return { status: "not-installed" };
    }
    const result = await module.exports.runCommand("schtasks.exe", [
      "/Delete",
      "/TN",
      name ?? TASK_NAME,
      "/F",
    ]);
    if (result.exitCode !== 0) {
      throw new Error(`schtasks /Delete failed: ${result.stderr.trim()}`);
    }
    return { status: "uninstalled" };
  }

  async status(name?: string): Promise<StatusResult> {
    const result = await module.exports.runCommand("schtasks.exe", [
      "/Query",
      "/TN",
      name ?? TASK_NAME,
      "/V",
      "/FO",
      "LIST",
    ]);
    if (result.exitCode !== 0) {
      return { state: "not-installed", manifestPath: null };
    }
    const out = result.stdout;
    // schtasks /V output includes "Status: Running" / "Ready" / "Disabled" lines.
    const running = /Status:\s*Running/i.test(out) || /0x41303/.test(out);
    return {
      state: running ? "installed-running" : "installed-stopped",
      manifestPath: manifestPath(),
    };
  }
}
```

Quirk being worked around: `import.meta.url` won't resolve cleanly after `tsup` bundling because we ship one `dist/index.js`. `process.argv[1]` is reliable for the entry script when invoked as `node dist/index.js` or via the `petforge` shim. If you change build output to multiple files this needs revisiting.

The `module.exports.runCommand(...)` / `module.exports.writeManifest(...)` pattern (instead of bare `runCommand(...)`) makes the functions reassignable from tests via `vi.spyOn(winMod, "runCommand")`. ESM exports are otherwise read-only.

Wait — in pure ESM modules `module.exports` doesn't exist. Use a small indirection instead:

Replace the bare calls with calls through a re-exported object. Add at top:

```ts
// Indirection layer so tests can stub these via vi.spyOn(winMod, "<name>").
export const exec = {
  runCommand,
  writeManifest,
};
```

…then inside the class call `exec.runCommand(...)` / `exec.writeManifest(...)`. Update the tests accordingly:

```ts
const runSpy = vi.spyOn(winMod.exec, "runCommand").mockResolvedValue(...);
const writeSpy = vi.spyOn(winMod.exec, "writeManifest").mockResolvedValue();
```

Adjust the test code from Step 3.1 before running.

- [ ] **Step 3.4: Re-run tests, expect PASS**

```bash
npx vitest run tests/service-windows.test.ts
```

Expected: all tests passing (Task 2's 7 + new ones).

- [ ] **Step 3.5: Run typecheck + lint**

```bash
npm run typecheck && npm run check
```

Expected: exit 0.

- [ ] **Step 3.6: Commit**

```bash
git add src/core/service/windows.ts tests/service-windows.test.ts
git commit -m "feat(service): Windows install/uninstall/status via schtasks"
```

---

## Task 4: macOS LaunchAgent plist builder (pure function)

**Files:**
- Modify: `src/core/service/macos.ts`
- Create: `tests/service-macos.test.ts`

- [ ] **Step 4.1: Write failing plist test**

Create `tests/service-macos.test.ts`:

```ts
import { describe, expect, it } from "vitest";
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
    // Order matters: node, entry, then upArgs.
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

  it("escapes XML metacharacters in args", () => {
    const plist = buildLaunchAgentPlist({ ...baseInput, upArgs: ["up", "--token=a&b"] });
    expect(plist).toContain("--token=a&amp;b");
  });
});
```

- [ ] **Step 4.2: Run test, expect FAIL**

```bash
npx vitest run tests/service-macos.test.ts
```

- [ ] **Step 4.3: Implement `buildLaunchAgentPlist`**

Replace `src/core/service/macos.ts` with:

```ts
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { InstallResult, ServiceArgs, ServiceManager, StatusResult, UninstallResult } from "./types.js";

const execFileP = promisify(execFile);
const LABEL = "com.mindvisionstudio.petforge";

export interface LaunchAgentInput {
  label: string;
  nodeExe: string;
  entryScript: string;
  upArgs: string[];
  workingDirectory: string;
  logDir: string;
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function buildLaunchAgentPlist(i: LaunchAgentInput): string {
  const program = [i.nodeExe, i.entryScript, ...i.upArgs];
  const programXml = program.map((s) => `      <string>${xmlEscape(s)}</string>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${xmlEscape(i.label)}</string>
    <key>ProgramArguments</key>
    <array>
${programXml}
    </array>
    <key>WorkingDirectory</key>
    <string>${xmlEscape(i.workingDirectory)}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${xmlEscape(path.join(i.logDir, "out.log"))}</string>
    <key>StandardErrorPath</key>
    <string>${xmlEscape(path.join(i.logDir, "err.log"))}</string>
    <key>ProcessType</key>
    <string>Background</string>
  </dict>
</plist>`;
}

export class MacOSServiceManager implements ServiceManager {
  install(_args: ServiceArgs): Promise<InstallResult> {
    throw new Error("MacOSServiceManager.install: not yet implemented");
  }
  uninstall(_name?: string): Promise<UninstallResult> {
    throw new Error("MacOSServiceManager.uninstall: not yet implemented");
  }
  status(_name?: string): Promise<StatusResult> {
    throw new Error("MacOSServiceManager.status: not yet implemented");
  }
}
```

- [ ] **Step 4.4: Run test, expect PASS**

```bash
npx vitest run tests/service-macos.test.ts
```

- [ ] **Step 4.5: Commit**

```bash
git add src/core/service/macos.ts tests/service-macos.test.ts
git commit -m "feat(service): macOS LaunchAgent plist builder"
```

---

## Task 5: MacOSServiceManager — install/uninstall/status

**Files:**
- Modify: `src/core/service/macos.ts`
- Modify: `tests/service-macos.test.ts`

- [ ] **Step 5.1: Write failing manager tests**

Append to `tests/service-macos.test.ts`:

```ts
import { afterEach, beforeEach, vi } from "vitest";
import * as macMod from "../src/core/service/macos.js";

describe("MacOSServiceManager.install", () => {
  let runSpy: ReturnType<typeof vi.spyOn>;
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    runSpy = vi.spyOn(macMod.exec, "runCommand").mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
    writeSpy = vi.spyOn(macMod.exec, "writePlist").mockResolvedValue();
  });

  afterEach(() => {
    runSpy.mockRestore();
    writeSpy.mockRestore();
  });

  it("writes the plist to ~/Library/LaunchAgents and runs launchctl bootstrap", async () => {
    const mgr = new macMod.MacOSServiceManager();
    const r = await mgr.install({ upArgs: ["--lan"] });
    expect(writeSpy).toHaveBeenCalledTimes(1);
    const [target] = writeSpy.mock.calls[0];
    expect(target).toMatch(/Library\/LaunchAgents\/com\.mindvisionstudio\.petforge\.plist$/);
    // First call: unload existing (if any); bootstrap; status check.
    const cmds = runSpy.mock.calls.map(([cmd, args]) => `${cmd} ${(args as string[]).join(" ")}`);
    expect(cmds.some((c) => c.includes("launchctl bootstrap gui/"))).toBe(true);
    expect(r.manifestPath).toMatch(/com\.mindvisionstudio\.petforge\.plist$/);
  });

  it("falls back to `launchctl load -w` when bootstrap returns non-zero", async () => {
    runSpy.mockImplementation(async (cmd: string, args: string[]) => {
      if (args[0] === "bootstrap") return { exitCode: 5, stdout: "", stderr: "Unrecognized" };
      return { exitCode: 0, stdout: "", stderr: "" };
    });
    const mgr = new macMod.MacOSServiceManager();
    await mgr.install({ upArgs: [] });
    const cmds = runSpy.mock.calls.map(([cmd, args]) => `${cmd} ${(args as string[]).join(" ")}`);
    expect(cmds.some((c) => c.includes("launchctl load -w"))).toBe(true);
  });
});

describe("MacOSServiceManager.status", () => {
  it("reports not-installed when no plist exists", async () => {
    const accessSpy = vi.spyOn(macMod.exec, "fileExists").mockResolvedValue(false);
    const mgr = new macMod.MacOSServiceManager();
    const s = await mgr.status();
    expect(s.state).toBe("not-installed");
    accessSpy.mockRestore();
  });

  it("reports installed-running when launchctl print shows state=running", async () => {
    vi.spyOn(macMod.exec, "fileExists").mockResolvedValue(true);
    vi.spyOn(macMod.exec, "runCommand").mockResolvedValue({
      exitCode: 0,
      stdout: "state = running\n",
      stderr: "",
    });
    const mgr = new macMod.MacOSServiceManager();
    const s = await mgr.status();
    expect(s.state).toBe("installed-running");
    vi.restoreAllMocks();
  });
});

describe("MacOSServiceManager.uninstall", () => {
  it("removes the plist file and runs launchctl bootout", async () => {
    vi.spyOn(macMod.exec, "fileExists").mockResolvedValue(true);
    const runSpy = vi.spyOn(macMod.exec, "runCommand").mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
    const rmSpy = vi.spyOn(macMod.exec, "removeFile").mockResolvedValue();
    const mgr = new macMod.MacOSServiceManager();
    const r = await mgr.uninstall();
    expect(r.status).toBe("uninstalled");
    expect(rmSpy).toHaveBeenCalled();
    const cmds = runSpy.mock.calls.map(([cmd, args]) => `${cmd} ${(args as string[]).join(" ")}`);
    expect(cmds.some((c) => c.includes("launchctl bootout gui/"))).toBe(true);
    vi.restoreAllMocks();
  });
});
```

- [ ] **Step 5.2: Run test, expect FAIL**

```bash
npx vitest run tests/service-macos.test.ts
```

- [ ] **Step 5.3: Implement the manager**

Replace `src/core/service/macos.ts` with the full version (paste below). The `exec` indirection layer mirrors Windows.

```ts
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { InstallResult, ServiceArgs, ServiceManager, StatusResult, UninstallResult } from "./types.js";

const execFileP = promisify(execFile);
const LABEL = "com.mindvisionstudio.petforge";

export interface LaunchAgentInput {
  label: string;
  nodeExe: string;
  entryScript: string;
  upArgs: string[];
  workingDirectory: string;
  logDir: string;
}

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

export function buildLaunchAgentPlist(i: LaunchAgentInput): string {
  // ... (paste from Task 4)
}

async function runCommand(cmd: string, args: string[]): Promise<CommandResult> {
  try {
    const { stdout, stderr } = await execFileP(cmd, args);
    return { exitCode: 0, stdout, stderr };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number };
    return { exitCode: typeof e.code === "number" ? e.code : 1, stdout: e.stdout ?? "", stderr: e.stderr ?? e.message ?? "" };
  }
}

async function writePlist(target: string, contents: string): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, contents, "utf8");
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function removeFile(p: string): Promise<void> {
  await fs.rm(p, { force: true });
}

export const exec = { runCommand, writePlist, fileExists, removeFile };

function plistPath(label: string): string {
  return path.join(os.homedir(), "Library", "LaunchAgents", `${label}.plist`);
}

function gui(): string {
  return `gui/${process.getuid?.() ?? 501}`;
}

function detectNodeExe(): string {
  return process.execPath;
}

function detectEntryScript(): string {
  return path.resolve(process.argv[1] ?? "");
}

function detectWorkingDirectory(entryScript: string): string {
  return path.dirname(path.dirname(entryScript));
}

function logDir(): string {
  return path.join(os.homedir(), ".petforge", "logs");
}

export class MacOSServiceManager implements ServiceManager {
  async install(args: ServiceArgs): Promise<InstallResult> {
    const label = args.name ?? LABEL;
    const target = plistPath(label);
    const wasInstalled = await exec.fileExists(target);

    const entryScript = detectEntryScript();
    const nodeExe = detectNodeExe();
    const workingDirectory = detectWorkingDirectory(entryScript);

    const plist = buildLaunchAgentPlist({
      label,
      nodeExe,
      entryScript,
      upArgs: ["up", ...args.upArgs],
      workingDirectory,
      logDir: logDir(),
    });

    await exec.writePlist(target, plist);

    if (wasInstalled) {
      // Best-effort unload before re-bootstrap; ignore failures.
      await exec.runCommand("launchctl", ["bootout", gui(), target]);
    }

    const boot = await exec.runCommand("launchctl", ["bootstrap", gui(), target]);
    if (boot.exitCode !== 0) {
      // Older macOS or sandboxing: fall back to `load -w`.
      const load = await exec.runCommand("launchctl", ["load", "-w", target]);
      if (load.exitCode !== 0) {
        throw new Error(`launchctl bootstrap/load failed: ${boot.stderr} | ${load.stderr}`);
      }
    }

    return {
      status: wasInstalled ? "updated" : "installed",
      manifestPath: target,
      hint: "Logs: " + logDir(),
    };
  }

  async uninstall(name?: string): Promise<UninstallResult> {
    const label = name ?? LABEL;
    const target = plistPath(label);
    if (!(await exec.fileExists(target))) {
      return { status: "not-installed" };
    }
    await exec.runCommand("launchctl", ["bootout", gui(), target]);
    await exec.removeFile(target);
    return { status: "uninstalled" };
  }

  async status(name?: string): Promise<StatusResult> {
    const label = name ?? LABEL;
    const target = plistPath(label);
    if (!(await exec.fileExists(target))) {
      return { state: "not-installed", manifestPath: null };
    }
    const r = await exec.runCommand("launchctl", ["print", `${gui()}/${label}`]);
    const running = /state\s*=\s*running/i.test(r.stdout);
    return {
      state: running ? "installed-running" : "installed-stopped",
      manifestPath: target,
    };
  }
}
```

- [ ] **Step 5.4: Re-run tests, expect PASS**

```bash
npx vitest run tests/service-macos.test.ts
```

- [ ] **Step 5.5: Typecheck + lint**

```bash
npm run typecheck && npm run check
```

- [ ] **Step 5.6: Commit**

```bash
git add src/core/service/macos.ts tests/service-macos.test.ts
git commit -m "feat(service): macOS install/uninstall/status via launchctl"
```

---

## Task 6: Linux systemd user-unit builder (pure function)

**Files:**
- Modify: `src/core/service/linux.ts`
- Create: `tests/service-linux.test.ts`

- [ ] **Step 6.1: Write failing unit-file test**

Create `tests/service-linux.test.ts`:

```ts
import { describe, expect, it } from "vitest";
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

  it("ExecStart wraps node and entry, then up args", () => {
    const unit = buildSystemdUserUnit(baseInput);
    expect(unit).toContain(`ExecStart=/usr/bin/node "${baseInput.entryScript}" up --lan`);
  });

  it("installs into default.target so it auto-starts on session", () => {
    const unit = buildSystemdUserUnit(baseInput);
    expect(unit).toMatch(/\[Install\][\s\S]*WantedBy=default\.target/);
  });

  it("uses Restart=on-failure", () => {
    const unit = buildSystemdUserUnit(baseInput);
    expect(unit).toContain("Restart=on-failure");
    expect(unit).toContain("RestartSec=3");
  });
});
```

- [ ] **Step 6.2: Run test, expect FAIL**

```bash
npx vitest run tests/service-linux.test.ts
```

- [ ] **Step 6.3: Implement `buildSystemdUserUnit`**

Replace `src/core/service/linux.ts` with:

```ts
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { InstallResult, ServiceArgs, ServiceManager, StatusResult, UninstallResult } from "./types.js";

const execFileP = promisify(execFile);
const UNIT_NAME = "petforge.service";

export interface SystemdUserUnitInput {
  description: string;
  nodeExe: string;
  entryScript: string;
  upArgs: string[];
  workingDirectory: string;
}

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function shellQuote(s: string): string {
  // systemd uses POSIX-shell-like splitting in ExecStart. Wrap in double quotes;
  // escape \ and " inside the path. Most npm install paths don't contain either.
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function buildSystemdUserUnit(i: SystemdUserUnitInput): string {
  const execStart = [i.nodeExe, shellQuote(i.entryScript), ...i.upArgs].join(" ");
  return `[Unit]
Description=${i.description}
After=default.target

[Service]
Type=simple
ExecStart=${execStart}
WorkingDirectory=${i.workingDirectory}
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
`;
}

export class LinuxServiceManager implements ServiceManager {
  install(_args: ServiceArgs): Promise<InstallResult> {
    throw new Error("LinuxServiceManager.install: not yet implemented");
  }
  uninstall(_name?: string): Promise<UninstallResult> {
    throw new Error("LinuxServiceManager.uninstall: not yet implemented");
  }
  status(_name?: string): Promise<StatusResult> {
    throw new Error("LinuxServiceManager.status: not yet implemented");
  }
}
```

- [ ] **Step 6.4: Run test, expect PASS**

```bash
npx vitest run tests/service-linux.test.ts
```

- [ ] **Step 6.5: Commit**

```bash
git add src/core/service/linux.ts tests/service-linux.test.ts
git commit -m "feat(service): systemd user-unit builder"
```

---

## Task 7: LinuxServiceManager — install/uninstall/status

**Files:**
- Modify: `src/core/service/linux.ts`
- Modify: `tests/service-linux.test.ts`

- [ ] **Step 7.1: Write failing manager tests**

Append to `tests/service-linux.test.ts`:

```ts
import { afterEach, beforeEach, vi } from "vitest";
import * as linMod from "../src/core/service/linux.js";

describe("LinuxServiceManager.install", () => {
  let runSpy: ReturnType<typeof vi.spyOn>;
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    runSpy = vi.spyOn(linMod.exec, "runCommand").mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
    writeSpy = vi.spyOn(linMod.exec, "writeUnit").mockResolvedValue();
    vi.spyOn(linMod.exec, "fileExists").mockResolvedValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes the unit to ~/.config/systemd/user and enables it", async () => {
    const mgr = new linMod.LinuxServiceManager();
    const r = await mgr.install({ upArgs: ["--lan"] });
    const [target] = writeSpy.mock.calls[0];
    expect(target).toMatch(/\.config\/systemd\/user\/petforge\.service$/);
    const cmds = runSpy.mock.calls.map(([cmd, args]) => `${cmd} ${(args as string[]).join(" ")}`);
    expect(cmds).toEqual(expect.arrayContaining([
      "systemctl --user daemon-reload",
      "systemctl --user enable --now petforge.service",
    ]));
    expect(r.hint).toContain("loginctl enable-linger");
  });

  it("throws a friendly error if systemctl --user is unavailable", async () => {
    runSpy.mockImplementation(async (cmd: string, args: string[]) => {
      if (args[0] === "--user" && args[1] === "daemon-reload") {
        return { exitCode: 1, stdout: "", stderr: "Failed to connect to bus: No such file or directory" };
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
    vi.spyOn(linMod.exec, "runCommand").mockResolvedValue({ exitCode: 0, stdout: "active\n", stderr: "" });
    const s = await new linMod.LinuxServiceManager().status();
    expect(s.state).toBe("installed-running");
  });

  it("returns installed-stopped when systemctl is-active prints 'inactive'", async () => {
    vi.spyOn(linMod.exec, "fileExists").mockResolvedValue(true);
    vi.spyOn(linMod.exec, "runCommand").mockResolvedValue({ exitCode: 3, stdout: "inactive\n", stderr: "" });
    const s = await new linMod.LinuxServiceManager().status();
    expect(s.state).toBe("installed-stopped");
  });
});

describe("LinuxServiceManager.uninstall", () => {
  afterEach(() => vi.restoreAllMocks());

  it("disables and stops the unit, then removes the file", async () => {
    vi.spyOn(linMod.exec, "fileExists").mockResolvedValue(true);
    const runSpy = vi.spyOn(linMod.exec, "runCommand").mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
    const rmSpy = vi.spyOn(linMod.exec, "removeFile").mockResolvedValue();
    const r = await new linMod.LinuxServiceManager().uninstall();
    expect(r.status).toBe("uninstalled");
    const cmds = runSpy.mock.calls.map(([cmd, args]) => `${cmd} ${(args as string[]).join(" ")}`);
    expect(cmds.some((c) => c.includes("disable --now petforge.service"))).toBe(true);
    expect(rmSpy).toHaveBeenCalled();
  });
});
```

- [ ] **Step 7.2: Run test, expect FAIL**

```bash
npx vitest run tests/service-linux.test.ts
```

- [ ] **Step 7.3: Implement the manager**

Replace `src/core/service/linux.ts` with the full version (paste below):

```ts
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { InstallResult, ServiceArgs, ServiceManager, StatusResult, UninstallResult } from "./types.js";

const execFileP = promisify(execFile);
const UNIT_NAME = "petforge.service";

export interface SystemdUserUnitInput {
  description: string;
  nodeExe: string;
  entryScript: string;
  upArgs: string[];
  workingDirectory: string;
}

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function shellQuote(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function buildSystemdUserUnit(i: SystemdUserUnitInput): string {
  // ... (paste from Task 6)
}

async function runCommand(cmd: string, args: string[]): Promise<CommandResult> {
  try {
    const { stdout, stderr } = await execFileP(cmd, args);
    return { exitCode: 0, stdout, stderr };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number };
    return { exitCode: typeof e.code === "number" ? e.code : 1, stdout: e.stdout ?? "", stderr: e.stderr ?? e.message ?? "" };
  }
}

async function writeUnit(target: string, contents: string): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, contents, "utf8");
}

async function fileExists(p: string): Promise<boolean> {
  try { await fs.access(p); return true; } catch { return false; }
}

async function removeFile(p: string): Promise<void> {
  await fs.rm(p, { force: true });
}

export const exec = { runCommand, writeUnit, fileExists, removeFile };

function unitPath(name: string): string {
  return path.join(os.homedir(), ".config", "systemd", "user", name);
}

function detectNodeExe(): string { return process.execPath; }
function detectEntryScript(): string { return path.resolve(process.argv[1] ?? ""); }
function detectWorkingDirectory(entryScript: string): string { return path.dirname(path.dirname(entryScript)); }

export class LinuxServiceManager implements ServiceManager {
  async install(args: ServiceArgs): Promise<InstallResult> {
    const name = args.name ?? UNIT_NAME;
    const target = unitPath(name);
    const wasInstalled = await exec.fileExists(target);

    const entryScript = detectEntryScript();
    const nodeExe = detectNodeExe();
    const workingDirectory = detectWorkingDirectory(entryScript);

    const unit = buildSystemdUserUnit({
      description: "PetForge auto-start",
      nodeExe,
      entryScript,
      upArgs: ["up", ...args.upArgs],
      workingDirectory,
    });

    await exec.writeUnit(target, unit);

    const reload = await exec.runCommand("systemctl", ["--user", "daemon-reload"]);
    if (reload.exitCode !== 0 && /Failed to connect to bus/i.test(reload.stderr)) {
      throw new Error(
        "systemd user instance is not available on this system. " +
          "PetForge service install requires systemd. " +
          "Stderr: " + reload.stderr.trim(),
      );
    }
    if (reload.exitCode !== 0) {
      throw new Error(`systemctl --user daemon-reload failed: ${reload.stderr.trim()}`);
    }

    const enable = await exec.runCommand("systemctl", ["--user", "enable", "--now", name]);
    if (enable.exitCode !== 0) {
      throw new Error(`systemctl --user enable --now failed: ${enable.stderr.trim()}`);
    }

    return {
      status: wasInstalled ? "updated" : "installed",
      manifestPath: target,
      hint: "Run `loginctl enable-linger $USER` (one-shot, requires sudo) if you want PetForge to keep running while you're logged out.",
    };
  }

  async uninstall(name?: string): Promise<UninstallResult> {
    const unit = name ?? UNIT_NAME;
    const target = unitPath(unit);
    if (!(await exec.fileExists(target))) {
      return { status: "not-installed" };
    }
    await exec.runCommand("systemctl", ["--user", "disable", "--now", unit]);
    await exec.runCommand("systemctl", ["--user", "daemon-reload"]);
    await exec.removeFile(target);
    return { status: "uninstalled" };
  }

  async status(name?: string): Promise<StatusResult> {
    const unit = name ?? UNIT_NAME;
    const target = unitPath(unit);
    if (!(await exec.fileExists(target))) {
      return { state: "not-installed", manifestPath: null };
    }
    const r = await exec.runCommand("systemctl", ["--user", "is-active", unit]);
    const trimmed = r.stdout.trim();
    if (trimmed === "active") return { state: "installed-running", manifestPath: target };
    return { state: "installed-stopped", manifestPath: target };
  }
}
```

- [ ] **Step 7.4: Re-run tests, expect PASS**

```bash
npx vitest run tests/service-linux.test.ts
```

- [ ] **Step 7.5: Typecheck + lint**

```bash
npm run typecheck && npm run check
```

- [ ] **Step 7.6: Commit**

```bash
git add src/core/service/linux.ts tests/service-linux.test.ts
git commit -m "feat(service): Linux install/uninstall/status via systemd --user"
```

---

## Task 8: `petforge service` CLI command

**Files:**
- Create: `src/commands/service.ts`
- Modify: `tests/service-cli.test.ts`

- [ ] **Step 8.1: Write failing CLI tests**

Append to `tests/service-cli.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import * as svcMod from "../src/core/service/index.js";

describe("serviceCli", () => {
  it("forwards --lan and --port=8000 as upArgs to install", async () => {
    const fakeMgr = {
      install: vi.fn().mockResolvedValue({ status: "installed", manifestPath: "/tmp/x", hint: "" }),
      uninstall: vi.fn(),
      status: vi.fn(),
    };
    vi.spyOn(svcMod, "getServiceManager").mockReturnValue(fakeMgr);
    const { serviceCli } = await import("../src/commands/service.js");
    const code = await serviceCli(["install", "--lan", "--port=8000"]);
    expect(code).toBe(0);
    expect(fakeMgr.install).toHaveBeenCalledWith({
      upArgs: ["--lan", "--port=8000"],
      name: undefined,
    });
    vi.restoreAllMocks();
  });

  it("'status' prints not-installed and exits 0 when nothing is installed", async () => {
    const fakeMgr = {
      install: vi.fn(),
      uninstall: vi.fn(),
      status: vi.fn().mockResolvedValue({ state: "not-installed", manifestPath: null }),
    };
    vi.spyOn(svcMod, "getServiceManager").mockReturnValue(fakeMgr);
    const { serviceCli } = await import("../src/commands/service.js");
    const writeMock = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const code = await serviceCli(["status"]);
    expect(code).toBe(0);
    const printed = writeMock.mock.calls.map((c) => c[0]).join("");
    expect(printed).toMatch(/not-installed|not installed/i);
    vi.restoreAllMocks();
  });

  it("'uninstall' exits 0 even when nothing was installed", async () => {
    const fakeMgr = {
      install: vi.fn(),
      uninstall: vi.fn().mockResolvedValue({ status: "not-installed" }),
      status: vi.fn(),
    };
    vi.spyOn(svcMod, "getServiceManager").mockReturnValue(fakeMgr);
    const { serviceCli } = await import("../src/commands/service.js");
    const code = await serviceCli(["uninstall"]);
    expect(code).toBe(0);
    vi.restoreAllMocks();
  });

  it("returns 1 with usage on unknown subcommand", async () => {
    const { serviceCli } = await import("../src/commands/service.js");
    const writeMock = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const code = await serviceCli(["foo"]);
    expect(code).toBe(1);
    const printed = writeMock.mock.calls.map((c) => c[0]).join("");
    expect(printed).toMatch(/Usage:\s+petforge service/);
    writeMock.mockRestore();
  });
});
```

- [ ] **Step 8.2: Run tests, expect FAIL**

```bash
npx vitest run tests/service-cli.test.ts
```

- [ ] **Step 8.3: Implement the CLI**

Create `src/commands/service.ts`:

```ts
/**
 * `petforge service install | uninstall | status` — manage the OS-native
 * auto-start hook so PetForge keeps running after a reboot.
 *
 * User-mode only. No admin/sudo required. See per-OS docs:
 *   Windows  Scheduled Task at logon  (schtasks.exe)
 *   macOS    LaunchAgent              (~/Library/LaunchAgents/)
 *   Linux    systemd --user unit      (~/.config/systemd/user/)
 */

import { getServiceManager } from "../core/service/index.js";

export async function serviceCli(argv: string[]): Promise<number> {
  const sub = argv[0];
  const rest = argv.slice(1);

  if (sub === undefined || sub === "--help" || sub === "-h") {
    process.stdout.write(usage());
    return sub === undefined ? 1 : 0;
  }

  let mgr;
  try {
    mgr = getServiceManager();
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n`);
    return 1;
  }

  try {
    if (sub === "install") {
      const { upArgs, name } = parseInstall(rest);
      const r = await mgr.install({ upArgs, name });
      process.stdout.write(
        `Service ${r.status} at ${r.manifestPath}\n` + (r.hint ? `Hint: ${r.hint}\n` : ""),
      );
      return 0;
    }
    if (sub === "uninstall") {
      const r = await mgr.uninstall();
      process.stdout.write(`Service ${r.status}\n`);
      return 0;
    }
    if (sub === "status") {
      const s = await mgr.status();
      process.stdout.write(`State: ${s.state}\n`);
      if (s.manifestPath) process.stdout.write(`Manifest: ${s.manifestPath}\n`);
      return 0;
    }
  } catch (err) {
    process.stderr.write(`petforge service ${sub} failed: ${(err as Error).message}\n`);
    return 1;
  }

  process.stderr.write(usage());
  return 1;
}

function parseInstall(argv: string[]): { upArgs: string[]; name: string | undefined } {
  const upArgs: string[] = [];
  let name: string | undefined;
  for (const a of argv) {
    if (a.startsWith("--name=")) {
      name = a.slice("--name=".length);
    } else {
      upArgs.push(a);
    }
  }
  return { upArgs, name };
}

function usage(): string {
  return [
    "Usage:",
    "  petforge service install [--lan] [--port=N] [--collect-port=N] [--host=IP] [--token=XXX] [--name=NAME]",
    "  petforge service uninstall",
    "  petforge service status",
    "",
    "User-mode only. PetForge will auto-start at user login on Windows / macOS / Linux.",
  ].join("\n") + "\n";
}
```

- [ ] **Step 8.4: Re-run tests, expect PASS**

```bash
npx vitest run tests/service-cli.test.ts
```

- [ ] **Step 8.5: Typecheck + lint**

```bash
npm run typecheck && npm run check
```

- [ ] **Step 8.6: Commit**

```bash
git add src/commands/service.ts tests/service-cli.test.ts
git commit -m "feat(service): petforge service install/uninstall/status command"
```

---

## Task 9: Wire `service` into the top-level CLI

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 9.1: Add the import and dispatch branch**

At the top of `src/index.ts`, alongside the other command imports (around line 14), add:

```ts
import { serviceCli } from "./commands/service.js";
```

Inside `main()`, just before the `if (cmd === "hook")` block (around line 92), add:

```ts
  if (cmd === "service") {
    return await serviceCli(args.slice(1));
  }
```

- [ ] **Step 9.2: Update the `--help` block**

In the help text inside `main()`, after the `up` command line (around line 51-54), add:

```ts
    console.log("  service install [args]  Install OS auto-start (user-mode)");
    console.log("                           Forwards args to `up`. See `petforge service --help`.");
    console.log("  service uninstall       Remove auto-start hook");
    console.log("  service status          Show installation state");
```

- [ ] **Step 9.3: Build and smoke-test**

```bash
npm run build
node dist/index.js --help | grep service
```

Expected: three `service ...` lines visible.

- [ ] **Step 9.4: Verify `service --help` end-to-end**

```bash
node dist/index.js service --help
```

Expected: the usage block from Task 8 prints, exit 0.

- [ ] **Step 9.5: Commit**

```bash
git add src/index.ts
git commit -m "feat(service): wire `petforge service` into the top-level CLI"
```

---

## Task 10: `doctor` integration — surface service state as a warning

**Files:**
- Modify: `src/commands/doctor.ts`
- Modify: `tests/doctor.test.ts`

- [ ] **Step 10.1: Update existing doctor test to expect one extra check**

Look at `tests/doctor.test.ts` for assertions on `result.checks.length` or for tests that iterate over checks. Add a new test that doesn't break the existing ones:

```ts
it("includes a (warning-only) service check", async () => {
  // Settings file with hooks present so the run goes far enough.
  const settingsDir = path.join(dir, ".claude");
  await fs.mkdir(settingsDir, { recursive: true });
  await fs.writeFile(
    path.join(settingsDir, "settings.json"),
    JSON.stringify({ hooks: {} }), // doesn't matter — service check is independent
    "utf8",
  );
  // Mock service manager so status() returns not-installed.
  vi.doMock("../src/core/service/index.js", () => ({
    getServiceManager: () => ({
      status: async () => ({ state: "not-installed", manifestPath: null }),
    }),
  }));
  const { runDoctor } = await import("../src/commands/doctor.js");
  const result = await runDoctor();
  const svc = result.checks.find((c) => c.name.includes("Auto-start service"));
  expect(svc).toBeDefined();
  expect(svc?.warning).toBe(true);
  expect(svc?.ok).toBe(false);
});
```

- [ ] **Step 10.2: Run test, expect FAIL**

```bash
npx vitest run tests/doctor.test.ts -t "service check"
```

- [ ] **Step 10.3: Implement the doctor check**

In `src/commands/doctor.ts`, near the end of `runDoctor()` after the buddy block, add:

```ts
  // Auto-start service (warning if not installed — purely optional).
  try {
    const { getServiceManager } = await import("../core/service/index.js");
    const s = await getServiceManager().status();
    checks.push({
      name: "Auto-start service",
      ok: s.state === "installed-running" || s.state === "installed-stopped",
      warning: s.state === "not-installed",
      detail:
        s.state === "not-installed"
          ? "Run `petforge service install --lan` to auto-start on login"
          : `state: ${s.state}`,
    });
  } catch (err) {
    checks.push({
      name: "Auto-start service",
      ok: false,
      warning: true,
      detail: `cannot query service: ${(err as Error).message}`,
    });
  }
```

- [ ] **Step 10.4: Re-run all doctor tests, expect PASS**

```bash
npx vitest run tests/doctor.test.ts
```

Adjust any prior test that hard-counted check totals.

- [ ] **Step 10.5: Commit**

```bash
git add src/commands/doctor.ts tests/doctor.test.ts
git commit -m "feat(doctor): show auto-start service state as warning-level check"
```

---

## Task 11: Full test sweep + build

- [ ] **Step 11.1: Run the entire suite**

```bash
npm run test
```

Expected: 0 failures across all test files.

- [ ] **Step 11.2: Typecheck the project**

```bash
npm run typecheck
```

Expected: exit 0.

- [ ] **Step 11.3: Biome check**

```bash
npm run check
```

Expected: exit 0. If formatting nits, run `npm run check:fix` and re-stage.

- [ ] **Step 11.4: Build the bundle**

```bash
npm run build
```

Expected: `dist/index.js` rebuilt, no errors.

- [ ] **Step 11.5: Live smoke test (the platform you're running on)**

```bash
# Windows
node dist/index.js service install --lan
node dist/index.js service status
node dist/index.js service uninstall

# macOS / Linux: substitute `node dist/index.js` with `./dist/index.js` if executable bit is set
```

Expected: each call exits 0 with a clear message; verify with the OS-native tool that the task/agent/unit appeared and disappeared.

- [ ] **Step 11.6: No commit — smoke testing only**

---

## Task 12: Docs + version bump + changelog

**Files:**
- Modify: `package.json`
- Modify: `README.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 12.1: Bump the version**

In `package.json`:

```diff
-  "version": "3.5.4",
+  "version": "3.6.0",
```

- [ ] **Step 12.2: Add a README section**

Insert a new H2 section in `README.md` titled "Auto-start on login" (place it after the existing `petforge up` section). Body:

````markdown
## Auto-start on login

Run PetForge as a user-mode service that comes up automatically when you log in. No admin / sudo required.

```bash
petforge service install --lan        # or any flags you'd pass to `petforge up`
petforge service status               # check whether it's running
petforge service uninstall            # remove the hook
```

Behind the scenes:

| OS      | Mechanism                       | Path                                                 |
|---------|---------------------------------|------------------------------------------------------|
| Windows | Scheduled Task (logon trigger)  | `schtasks /TN PetForge`                              |
| macOS   | LaunchAgent                     | `~/Library/LaunchAgents/com.mindvisionstudio.petforge.plist` |
| Linux   | systemd `--user` unit           | `~/.config/systemd/user/petforge.service`            |

On Linux, if you want PetForge to keep running while you're logged out, run once (requires sudo):

```bash
sudo loginctl enable-linger "$USER"
```
````

- [ ] **Step 12.3: Add CHANGELOG entry**

Insert at the top of `CHANGELOG.md`:

```markdown
## 3.6.0

### Features

- **`petforge service install | uninstall | status`** — manage OS-native
  auto-start (user-mode) across Windows (Scheduled Task), macOS (LaunchAgent),
  and Linux (systemd `--user`). No admin/sudo required on any platform.
- `petforge doctor` now reports auto-start service state as a warning-level
  check (optional, never critical).
```

- [ ] **Step 12.4: Final sanity build**

```bash
npm run prepublishOnly
```

Expected: check, typecheck, test, build — all green.

- [ ] **Step 12.5: Commit**

```bash
git add package.json README.md CHANGELOG.md
git commit -m "release: v3.6.0 — service install (user-mode, tri-OS)"
```

---

## Self-Review

**Spec coverage:**
- Windows user-mode Scheduled Task — Tasks 2, 3, 11.5 ✓
- macOS user-mode LaunchAgent — Tasks 4, 5, 11.5 ✓
- Linux systemd --user unit — Tasks 6, 7, 11.5 ✓
- CLI `petforge service install/uninstall/status` — Tasks 8, 9 ✓
- Pure-function manifest builders unit-tested without spawning real OS calls — Tasks 2, 4, 6 ✓
- Manager methods mock the OS shims and assert on commands — Tasks 3, 5, 7 ✓
- Idempotency (install over existing → "updated") — Tasks 3, 5, 7 ✓
- Linger hint on Linux — Task 7 ✓
- README + CHANGELOG + version bump — Task 12 ✓
- Doctor integration — Task 10 ✓

**Placeholder scan:**
- Tasks 3, 5, 7 reference "paste from Task N" for the pure builder — engineer needs to literally copy the previous task's function body into the new file because it now coexists with the manager class. This is fine since the previous task IS in this same plan above; not a blocker.

**Type consistency:**
- `ServiceManager` / `ServiceArgs` / `InstallResult` / `UninstallResult` / `StatusResult` / `ServiceState` defined in Task 1 — used unchanged in all subsequent tasks ✓
- Class names match exactly: `WindowsServiceManager`, `MacOSServiceManager`, `LinuxServiceManager` ✓
- Each manager exports an `exec` object with the same shape (`runCommand`, plus a `write*` / `fileExists` / `removeFile` set per platform) — different shape per platform is intentional (different OS tools).

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-11-service-install-plan.md`. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks. Best when you want to keep this conversation's context free and let each task ship cleanly.
2. **Inline Execution** — execute tasks in this session using `superpowers:executing-plans`, batch with checkpoints. Best when you want to watch each task land and intervene mid-way.

Which approach?
