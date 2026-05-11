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

async function writeUnit(target: string, contents: string): Promise<void> {
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

// Indirection object: tests stub via vi.spyOn(linMod.exec, "<name>").
export const exec = { runCommand, writeUnit, fileExists, removeFile };

function unitPath(name: string): string {
  return path.join(os.homedir(), ".config", "systemd", "user", name);
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
    if (reload.exitCode !== 0) {
      if (/Failed to connect to bus/i.test(reload.stderr)) {
        throw new Error(
          "systemd user instance is not available on this system. " +
            "PetForge service install requires systemd. " +
            `Stderr: ${reload.stderr.trim()}`,
        );
      }
      throw new Error(`systemctl --user daemon-reload failed: ${reload.stderr.trim()}`);
    }

    const enable = await exec.runCommand("systemctl", ["--user", "enable", "--now", name]);
    if (enable.exitCode !== 0) {
      throw new Error(`systemctl --user enable --now failed: ${enable.stderr.trim()}`);
    }

    return {
      status: wasInstalled ? "updated" : "installed",
      manifestPath: target,
      hint:
        "Run `loginctl enable-linger $USER` (one-shot, requires sudo) if you want " +
        "PetForge to keep running while you're logged out.",
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
