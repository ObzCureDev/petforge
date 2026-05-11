import type { InstallResult, ServiceArgs, ServiceManager, StatusResult, UninstallResult } from "./types.js";

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
