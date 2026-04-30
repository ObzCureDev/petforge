#!/usr/bin/env node

const args = process.argv.slice(2);

if (args[0] === "--help" || args[0] === "-h" || args.length === 0) {
  console.log("PetForge — Local-first RPG progression layer for AI coding companions");
  console.log("");
  console.log("Usage: petforge [command]");
  console.log("");
  console.log("Commands will be added in subsequent tasks.");
  process.exit(0);
}

if (args[0] === "--version" || args[0] === "-v") {
  console.log("0.0.0");
  process.exit(0);
}

console.error(`Unknown command: ${args[0]}`);
process.exit(1);
