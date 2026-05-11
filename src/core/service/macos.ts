import type { InstallResult, ServiceArgs, ServiceManager, StatusResult, UninstallResult } from "./types.js";

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
