import { describe, expect, it } from "vitest";
import { buildLaunchAgentPlist } from "../src/core/service/macos.js";

describe("buildLaunchAgentPlist", () => {
  const baseInput = {
    label: "com.mindvisionstudio.petforge",
    nodeExe: "/usr/local/bin/node",
    entryScript: "/Users/dan/.npm-global/lib/node_modules/@mindvisionstudio/petforge/dist/index.js",
    upArgs: ["up", "--lan"],
    workingDirectory: "/Users/dan/.npm-global/lib/node_modules/@mindvisionstudio/petforge",
    logDir: "/Users/dan/.petforge/logs",
  };

  it("contains the label", () => {
    const plist = buildLaunchAgentPlist(baseInput);
    expect(plist).toContain("<key>Label</key>");
    expect(plist).toContain("<string>com.mindvisionstudio.petforge</string>");
  });

  it("contains node + entry + up args as a ProgramArguments array", () => {
    const plist = buildLaunchAgentPlist(baseInput);
    expect(plist).toContain("<key>ProgramArguments</key>");
    const programIdx = plist.indexOf("ProgramArguments");
    const nodeIdx = plist.indexOf(baseInput.nodeExe, programIdx);
    const entryIdx = plist.indexOf(baseInput.entryScript, programIdx);
    const lanIdx = plist.indexOf("--lan", programIdx);
    expect(nodeIdx).toBeGreaterThan(programIdx);
    expect(entryIdx).toBeGreaterThan(nodeIdx);
    expect(lanIdx).toBeGreaterThan(entryIdx);
  });

  it("enables RunAtLoad and KeepAlive (auto-restart on crash)", () => {
    const plist = buildLaunchAgentPlist(baseInput);
    expect(plist).toMatch(/<key>RunAtLoad<\/key>\s*<true\/>/);
    expect(plist).toMatch(/<key>KeepAlive<\/key>\s*<true\/>/);
  });

  it("redirects stdout and stderr into the log directory", () => {
    const plist = buildLaunchAgentPlist(baseInput);
    expect(plist).toContain("<key>StandardOutPath</key>");
    expect(plist).toContain("/Users/dan/.petforge/logs/out.log");
    expect(plist).toContain("<key>StandardErrorPath</key>");
    expect(plist).toContain("/Users/dan/.petforge/logs/err.log");
  });

  it("escapes XML metacharacters in args (regression: --token=a&b)", () => {
    const plist = buildLaunchAgentPlist({ ...baseInput, upArgs: ["up", "--token=a&b"] });
    expect(plist).toContain("--token=a&amp;b");
    expect(plist).not.toContain("--token=a&b<");
  });
});
