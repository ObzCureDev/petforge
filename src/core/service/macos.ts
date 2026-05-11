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
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function buildLaunchAgentPlist(i: LaunchAgentInput): string {
  // Per-token escape on each ProgramArguments element so user-supplied
  // upArgs like `--token=a&b` don't break the plist.
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
    <string>${xmlEscape(path.posix.join(i.logDir, "out.log"))}</string>
    <key>StandardErrorPath</key>
    <string>${xmlEscape(path.posix.join(i.logDir, "err.log"))}</string>
    <key>ProcessType</key>
    <string>Background</string>
  </dict>
</plist>`;
}

async function runCommand(cmd: string, args: string[]): Promise<CommandResult> {
  try {
    const { stdout, stderr } = await execFileP(cmd, args);
    return { exitCode: 0, stdout, stderr };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
      code?: number | string;
    };
    const exitCode = typeof e.code === "number" ? e.code : 1;
    return { exitCode, stdout: e.stdout ?? "", stderr: e.stderr ?? e.message ?? "" };
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

// Indirection object: tests stub via vi.spyOn(macMod.exec, "<name>").
export const exec = { runCommand, writePlist, fileExists, removeFile };

function plistPath(label: string): string {
  return path.join(os.homedir(), "Library", "LaunchAgents", `${label}.plist`);
}

function gui(): string {
  // process.getuid is unavailable on Windows — optional chain + 501 fallback
  // keeps the file importable when the factory imports all three managers.
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
      // Best-effort: unload before re-bootstrap; ignore failures.
      await exec.runCommand("launchctl", ["bootout", gui(), target]);
    }

    const boot = await exec.runCommand("launchctl", ["bootstrap", gui(), target]);
    if (boot.exitCode !== 0) {
      // Older macOS or sandbox restrictions — fall back to `load -w`.
      const load = await exec.runCommand("launchctl", ["load", "-w", target]);
      if (load.exitCode !== 0) {
        throw new Error(
          `launchctl bootstrap/load failed: ${boot.stderr.trim()} | ${load.stderr.trim()}`,
        );
      }
    }

    return {
      status: wasInstalled ? "updated" : "installed",
      manifestPath: target,
      hint: `Logs: ${logDir()}`,
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
    // Line-anchored: matches "state = running" but NOT "state = not running",
    // because the latter starts with "state = not " on its line.
    const running = /^\s*state\s*=\s*running/im.test(r.stdout);
    return {
      state: running ? "installed-running" : "installed-stopped",
      manifestPath: target,
    };
  }
}
