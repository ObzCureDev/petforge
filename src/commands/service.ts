/**
 * `petforge service install | uninstall | status` — manage the OS-native
 * auto-start hook so PetForge keeps running after a reboot.
 *
 * User-mode only. No admin/sudo required.
 *
 * Per-OS mechanism:
 *   Windows  Scheduled Task at logon  (schtasks.exe)
 *   macOS    LaunchAgent              (~/Library/LaunchAgents/)
 *   Linux    systemd --user unit      (~/.config/systemd/user/)
 */

import type { ServiceManager } from "../core/service/index.js";
import { getServiceManager } from "../core/service/index.js";

export async function serviceCli(argv: string[]): Promise<number> {
  const sub = argv[0];
  const rest = argv.slice(1);

  if (sub === undefined) {
    process.stderr.write(usage());
    return 1;
  }
  if (sub === "--help" || sub === "-h") {
    process.stdout.write(usage());
    return 0;
  }

  let mgr: ServiceManager;
  try {
    mgr = getServiceManager();
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n`);
    return 1;
  }

  try {
    if (sub === "install") {
      const { upArgs, name } = parseInstall(rest);
      const r = await mgr.install({ upArgs, name });
      process.stdout.write(`Service ${r.status} at ${r.manifestPath}\n`);
      if (r.hint) {
        process.stdout.write(`Hint: ${r.hint}\n`);
      }
      return 0;
    }
    if (sub === "uninstall") {
      const r = await mgr.uninstall();
      process.stdout.write(`Service ${r.status}\n`);
      return 0;
    }
    if (sub === "status") {
      const s = await mgr.status();
      process.stdout.write(`State: ${s.state}\n`);
      if (s.manifestPath) {
        process.stdout.write(`Manifest: ${s.manifestPath}\n`);
      }
      return 0;
    }
  } catch (err) {
    process.stderr.write(`petforge service ${sub} failed: ${(err as Error).message}\n`);
    return 1;
  }

  process.stderr.write(usage());
  return 1;
}

function parseInstall(argv: string[]): { upArgs: string[]; name: string | undefined } {
  const upArgs: string[] = [];
  let name: string | undefined;
  for (const a of argv) {
    if (a.startsWith("--name=")) {
      name = a.slice("--name=".length);
    } else {
      upArgs.push(a);
    }
  }
  return { upArgs, name };
}

function usage(): string {
  return [
    "Usage:",
    "  petforge service install [--lan] [--port=N] [--collect-port=N] [--host=IP] [--token=XXX] [--name=NAME]",
    "  petforge service uninstall",
    "  petforge service status",
    "",
    "User-mode only. PetForge auto-starts at user login on Windows / macOS / Linux.",
    "",
  ].join("\n");
}
