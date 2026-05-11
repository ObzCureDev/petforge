import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type {
  InstallResult,
  ServiceArgs,
  ServiceManager,
  StatusResult,
  UninstallResult,
} from "./types.js";

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
  // Escape per-token so the structural quotes around the entry script stay
  // literal, but XML-unsafe characters inside user-supplied upArgs (e.g.
  // `--token=a&b`) are escaped to keep the manifest well-formed.
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

async function runCommand(cmd: string, args: string[]): Promise<CommandResult> {
  try {
    const { stdout, stderr } = await execFileP(cmd, args, { windowsHide: true });
    return { exitCode: 0, stdout, stderr };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
      code?: number | string;
    };
    const exitCode = typeof e.code === "number" ? e.code : 1;
    return {
      exitCode,
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? e.message ?? "",
    };
  }
}

async function writeManifest(target: string, contents: string): Promise<void> {
  // Task Scheduler requires UTF-16 LE with BOM for the XML manifest.
  const buf = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(contents, "utf16le")]);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, buf);
}

// Indirection object: tests stub via vi.spyOn(winMod.exec, "<name>").
// Don't bypass this in the manager methods.
export const exec = { runCommand, writeManifest };

function detectNodeExe(): string {
  return process.execPath;
}

function detectEntryScript(): string {
  // tsup bundles to a single dist/index.js. process.argv[1] is the entry
  // when invoked as `node dist/index.js` or via the npm bin shim.
  return path.resolve(process.argv[1] ?? "");
}

function detectWorkingDirectory(entryScript: string): string {
  // dist/index.js → dist → package root
  return path.dirname(path.dirname(entryScript));
}

function detectUserId(): string {
  const domain = process.env.USERDOMAIN ?? os.hostname();
  const user = process.env.USERNAME ?? os.userInfo().username;
  return `${domain}\\${user}`;
}

function manifestPath(): string {
  return path.join(os.tmpdir(), "petforge-service", "task.xml");
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
    await exec.writeManifest(target, xml);

    const result = await exec.runCommand("schtasks.exe", [
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
    const result = await exec.runCommand("schtasks.exe", [
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
    const result = await exec.runCommand("schtasks.exe", [
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
    const running = /^Status:\s*Running/im.test(result.stdout);
    return {
      state: running ? "installed-running" : "installed-stopped",
      manifestPath: manifestPath(),
    };
  }
}
