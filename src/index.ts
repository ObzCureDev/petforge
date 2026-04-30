#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buddyCli } from "./commands/buddy.js";
import { cardCli } from "./commands/card.js";
import { defaultCli } from "./commands/default.js";
import { doctorCli } from "./commands/doctor.js";
import { hookCli } from "./commands/hook.js";
import { initCli } from "./commands/init.js";
import { watchCli } from "./commands/watch.js";

function readVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    // dist/index.js → ../package.json
    const pkgPath = join(here, "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    return typeof pkg.version === "string" ? pkg.version : "unknown";
  } catch {
    return "unknown";
  }
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const cmd = args[0];

  if (cmd === "--help" || cmd === "-h") {
    console.log("PetForge — Local-first RPG progression layer for AI coding companions");
    console.log("");
    console.log("Usage: petforge [command]");
    console.log("");
    console.log("Commands:");
    console.log("  (no args)   Show your pet (static snapshot, or animated in a TTY)");
    console.log("  card        Show full status: pet, stats, achievements");
    console.log("  watch       Live animated view at 8 FPS (Ctrl+C / q to exit)");
    console.log("  init        Register PetForge hooks in ~/.claude/settings.json");
    console.log("  doctor      Diagnostic checklist (Node, state, hooks, claude integration)");
    console.log("  buddy [on|off|auto]");
    console.log("              Show or set Buddy integration mode");
    console.log("  hook        Internal: process a Claude Code hook event from stdin");
    console.log("  --version   Show version");
    return 0;
  }

  if (cmd === "--version" || cmd === "-v") {
    console.log(readVersion());
    return 0;
  }

  if (cmd === undefined) {
    return await defaultCli();
  }
  if (cmd === "card") {
    return await cardCli();
  }
  if (cmd === "watch") {
    return await watchCli();
  }
  if (cmd === "init") {
    return await initCli(args.slice(1));
  }
  if (cmd === "doctor") {
    return await doctorCli(args.slice(1));
  }
  if (cmd === "buddy") {
    return await buddyCli(args.slice(1));
  }
  if (cmd === "hook") {
    return await hookCli(args.slice(1));
  }

  console.error(`Unknown command: ${cmd}`);
  return 1;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
