import type { InstallResult, ServiceArgs, ServiceManager, StatusResult, UninstallResult } from "./types.js";

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
