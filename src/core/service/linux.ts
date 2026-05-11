import type {
  InstallResult,
  ServiceArgs,
  ServiceManager,
  StatusResult,
  UninstallResult,
} from "./types.js";

export interface SystemdUserUnitInput {
  description: string;
  nodeExe: string;
  entryScript: string;
  upArgs: string[];
  workingDirectory: string;
}

function shellQuote(s: string): string {
  // systemd ExecStart splits POSIX-shell-like. Wrap in double quotes and escape
  // \ and " inside. Common npm install paths don't contain either, but escape
  // defensively for paths with spaces or special chars.
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
  async install(_args: ServiceArgs): Promise<InstallResult> {
    throw new Error("LinuxServiceManager.install: not yet implemented");
  }
  async uninstall(_name?: string): Promise<UninstallResult> {
    throw new Error("LinuxServiceManager.uninstall: not yet implemented");
  }
  async status(_name?: string): Promise<StatusResult> {
    throw new Error("LinuxServiceManager.status: not yet implemented");
  }
}
