#!/usr/bin/env node

import { cardCli } from "./commands/card.js";
import { defaultCli } from "./commands/default.js";
import { hookCli } from "./commands/hook.js";
import { initCli } from "./commands/init.js";
import { watchCli } from "./commands/watch.js";

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
    console.log("  hook        Internal: process a Claude Code hook event from stdin");
    console.log("  --version   Show version");
    return 0;
  }

  if (cmd === "--version" || cmd === "-v") {
    console.log("0.0.0");
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
