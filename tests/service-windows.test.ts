import { describe, expect, it } from "vitest";
import { buildScheduledTaskXml } from "../src/core/service/windows.js";

describe("buildScheduledTaskXml", () => {
  const baseInput = {
    description: "PetForge auto-start (user logon)",
    userId: "DAN-PC\\dan",
    nodeExe: "C:\\Program Files\\nodejs\\node.exe",
    entryScript:
      "C:\\Users\\dan\\AppData\\Roaming\\npm\\node_modules\\@mindvisionstudio\\petforge\\dist\\index.js",
    upArgs: ["up", "--lan"],
    workingDirectory:
      "C:\\Users\\dan\\AppData\\Roaming\\npm\\node_modules\\@mindvisionstudio\\petforge",
  };

  it("contains a LogonTrigger and AtLogon trigger type", () => {
    const xml = buildScheduledTaskXml(baseInput);
    expect(xml).toContain("<LogonTrigger>");
    expect(xml).toContain("<Enabled>true</Enabled>");
  });

  it("embeds the node executable in <Command>", () => {
    const xml = buildScheduledTaskXml(baseInput);
    expect(xml).toContain("<Command>C:\\Program Files\\nodejs\\node.exe</Command>");
  });

  it("embeds the up args after the entry script in <Arguments>", () => {
    const xml = buildScheduledTaskXml(baseInput);
    // Arguments token: "<entry>" up --lan
    expect(xml).toMatch(
      /<Arguments>"C:\\Users\\dan\\AppData\\Roaming\\npm\\node_modules\\@mindvisionstudio\\petforge\\dist\\index\.js" up --lan<\/Arguments>/,
    );
  });

  it("uses InteractiveToken so no password is required", () => {
    const xml = buildScheduledTaskXml(baseInput);
    expect(xml).toContain("<LogonType>InteractiveToken</LogonType>");
  });

  it("sets ExecutionTimeLimit to PT0S (no timeout)", () => {
    const xml = buildScheduledTaskXml(baseInput);
    expect(xml).toContain("<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>");
  });

  it("escapes XML metacharacters in the description", () => {
    const xml = buildScheduledTaskXml({ ...baseInput, description: '<bad> & "quoted"' });
    expect(xml).toContain("&lt;bad&gt; &amp; &quot;quoted&quot;");
  });

  it("does not run if on batteries by default", () => {
    const xml = buildScheduledTaskXml(baseInput);
    expect(xml).toContain("<DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>");
    expect(xml).toContain("<StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>");
  });
});
