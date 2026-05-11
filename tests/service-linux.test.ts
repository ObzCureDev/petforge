import { describe, expect, it } from "vitest";
import { buildSystemdUserUnit } from "../src/core/service/linux.js";

describe("buildSystemdUserUnit", () => {
  const baseInput = {
    description: "PetForge auto-start",
    nodeExe: "/usr/bin/node",
    entryScript: "/home/dan/.npm-global/lib/node_modules/@mindvisionstudio/petforge/dist/index.js",
    upArgs: ["up", "--lan"],
    workingDirectory: "/home/dan/.npm-global/lib/node_modules/@mindvisionstudio/petforge",
  };

  it("starts with [Unit] section and a Description", () => {
    const unit = buildSystemdUserUnit(baseInput);
    expect(unit).toMatch(/^\[Unit\]\s*\nDescription=PetForge auto-start/);
  });

  it("ExecStart wraps node, then the entry script in double quotes, then up args", () => {
    const unit = buildSystemdUserUnit(baseInput);
    expect(unit).toContain(`ExecStart=/usr/bin/node "${baseInput.entryScript}" up --lan`);
  });

  it("installs into default.target so it auto-starts on session", () => {
    const unit = buildSystemdUserUnit(baseInput);
    expect(unit).toMatch(/\[Install\][\s\S]*WantedBy=default\.target/);
  });

  it("uses Restart=on-failure with RestartSec=3", () => {
    const unit = buildSystemdUserUnit(baseInput);
    expect(unit).toContain("Restart=on-failure");
    expect(unit).toContain("RestartSec=3");
  });
});
