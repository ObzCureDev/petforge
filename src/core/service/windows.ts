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
