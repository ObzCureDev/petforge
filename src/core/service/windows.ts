import type {
  InstallResult,
  ServiceArgs,
  ServiceManager,
  StatusResult,
  UninstallResult,
} from "./types.js";

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
  const argString = [`"${i.entryScript}"`, ...i.upArgs].join(" ");
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
      <Command>${i.nodeExe}</Command>
      <Arguments>${argString}</Arguments>
      <WorkingDirectory>${i.workingDirectory}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>`;
}

export class WindowsServiceManager implements ServiceManager {
  async install(_args: ServiceArgs): Promise<InstallResult> {
    throw new Error("WindowsServiceManager.install: not yet implemented");
  }
  async uninstall(_name?: string): Promise<UninstallResult> {
    throw new Error("WindowsServiceManager.uninstall: not yet implemented");
  }
  async status(_name?: string): Promise<StatusResult> {
    throw new Error("WindowsServiceManager.status: not yet implemented");
  }
}
