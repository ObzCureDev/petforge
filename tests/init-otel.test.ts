/**
 * Tests for `petforge init --otel` / `--no-otel` flags.
 *
 * These cover the V2.0 OTel-env-block extension to runInit. Hooks logic is
 * already covered by tests/init.test.ts — these focus on the env block.
 */

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runInit } from "../src/commands/init.js";

let dir: string;
let settingsPath: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "petforge-init-otel-"));
  settingsPath = path.join(dir, "settings.json");
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("runInit --otel / --no-otel", () => {
  it("--otel writes the env block alongside hooks", async () => {
    const result = await runInit({ yes: true, settingsPath, otel: true });
    expect(result.status).toBe("ok-installed");
    const written = JSON.parse(await fs.readFile(settingsPath, "utf8"));
    expect(written.env.CLAUDE_CODE_ENABLE_TELEMETRY).toBe("1");
    expect(written.env.OTEL_EXPORTER_OTLP_ENDPOINT).toBe("http://127.0.0.1:7879");
    expect(written.hooks?.UserPromptSubmit).toBeDefined();
  });

  it("--no-otel strips the env block", async () => {
    await runInit({ yes: true, settingsPath, otel: true });
    const result = await runInit({ yes: true, settingsPath, noOtel: true });
    expect(result.status).toMatch(/ok-/);
    const written = JSON.parse(await fs.readFile(settingsPath, "utf8"));
    expect(written.env.CLAUDE_CODE_ENABLE_TELEMETRY).toBeUndefined();
  });

  it("conflict (existing OTEL_EXPORTER_OTLP_ENDPOINT pointing elsewhere) blocks without --force", async () => {
    const existing = {
      env: { OTEL_EXPORTER_OTLP_ENDPOINT: "https://otelcol.example.com:4318" },
    };
    await fs.writeFile(settingsPath, JSON.stringify(existing));
    const result = await runInit({ yes: true, settingsPath, otel: true });
    expect(result.status).toBe("error-conflict");
  });

  it("--force overrides the conflict", async () => {
    const existing = {
      env: { OTEL_EXPORTER_OTLP_ENDPOINT: "https://otelcol.example.com:4318" },
    };
    await fs.writeFile(settingsPath, JSON.stringify(existing));
    const result = await runInit({ yes: true, settingsPath, otel: true, force: true });
    expect(result.status).toBe("ok-installed");
    const written = JSON.parse(await fs.readFile(settingsPath, "utf8"));
    expect(written.env.OTEL_EXPORTER_OTLP_ENDPOINT).toBe("http://127.0.0.1:7879");
  });

  it("preserves unrelated env entries", async () => {
    const existing = { env: { MY_KEY: "value" } };
    await fs.writeFile(settingsPath, JSON.stringify(existing));
    await runInit({ yes: true, settingsPath, otel: true });
    const written = JSON.parse(await fs.readFile(settingsPath, "utf8"));
    expect(written.env.MY_KEY).toBe("value");
    expect(written.env.CLAUDE_CODE_ENABLE_TELEMETRY).toBe("1");
  });

  it("--no-otel preserves unrelated env entries", async () => {
    await runInit({ yes: true, settingsPath, otel: true });
    // Add an unrelated key
    const intermediate = JSON.parse(await fs.readFile(settingsPath, "utf8"));
    intermediate.env.MY_KEY = "value";
    await fs.writeFile(settingsPath, JSON.stringify(intermediate));
    await runInit({ yes: true, settingsPath, noOtel: true });
    const written = JSON.parse(await fs.readFile(settingsPath, "utf8"));
    expect(written.env.MY_KEY).toBe("value");
    expect(written.env.CLAUDE_CODE_ENABLE_TELEMETRY).toBeUndefined();
  });
});
