import path from "node:path";
import type {
  InstallResult,
  ServiceArgs,
  ServiceManager,
  StatusResult,
  UninstallResult,
} from "./types.js";

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

export class MacOSServiceManager implements ServiceManager {
  async install(_args: ServiceArgs): Promise<InstallResult> {
    throw new Error("MacOSServiceManager.install: not yet implemented");
  }
  async uninstall(_name?: string): Promise<UninstallResult> {
    throw new Error("MacOSServiceManager.uninstall: not yet implemented");
  }
  async status(_name?: string): Promise<StatusResult> {
    throw new Error("MacOSServiceManager.status: not yet implemented");
  }
}
