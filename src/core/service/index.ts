import { LinuxServiceManager } from "./linux.js";
import { MacOSServiceManager } from "./macos.js";
import type { ServiceManager } from "./types.js";
import { WindowsServiceManager } from "./windows.js";

export type {
  InstallResult,
  ServiceArgs,
  ServiceManager,
  ServiceState,
  StatusResult,
  UninstallResult,
} from "./types.js";

export function getServiceManager(): ServiceManager {
  switch (process.platform) {
    case "win32":
      return new WindowsServiceManager();
    case "darwin":
      return new MacOSServiceManager();
    case "linux":
      return new LinuxServiceManager();
    default:
      throw new Error(`unsupported platform: ${process.platform}`);
  }
}
