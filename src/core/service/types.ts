export interface ServiceArgs {
  /** Flags forwarded verbatim to `petforge up`. Each string is one token, e.g. ["--lan", "--port=8000"]. */
  upArgs: string[];
  /** Override the default service name ("petforge"). Lower-case, no spaces. */
  name?: string;
}

export type ServiceState = "installed-running" | "installed-stopped" | "not-installed";

export interface InstallResult {
  status: "installed" | "updated";
  /** Filesystem path of the installed manifest (XML / plist / unit file). */
  manifestPath: string;
  /** Free-form hint for the user (e.g. linger note on Linux). Empty string if none. */
  hint: string;
}

export interface UninstallResult {
  status: "uninstalled" | "not-installed";
}

export interface StatusResult {
  state: ServiceState;
  /** Filesystem path of the manifest if installed, otherwise null. */
  manifestPath: string | null;
}

export interface ServiceManager {
  install(args: ServiceArgs): Promise<InstallResult>;
  uninstall(name?: string): Promise<UninstallResult>;
  status(name?: string): Promise<StatusResult>;
}
