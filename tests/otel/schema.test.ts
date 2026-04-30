import { describe, expect, it } from "vitest";
import {
  createInitialOtelCounters,
  type OtelCounters,
  OtelCountersSchema,
} from "../../src/core/otel/schema.js";
import { generatePet } from "../../src/core/pet-engine.js";
import { createInitialState, ensureOtelCounters, type State } from "../../src/core/schema.js";

describe("OtelCounters", () => {
  it("createInitialOtelCounters returns all-zero structure with empty modelUsage", () => {
    const c = createInitialOtelCounters();
    expect(c.linesAdded).toBe(0);
    expect(c.linesRemoved).toBe(0);
    expect(c.tokensIn).toBe(0);
    expect(c.tokensOut).toBe(0);
    expect(c.tokensCacheRead).toBe(0);
    expect(c.tokensCacheCreation).toBe(0);
    expect(c.costUsdCents).toBe(0);
    expect(c.editsAccepted).toBe(0);
    expect(c.editsRejected).toBe(0);
    expect(c.toolDecisionsAccepted).toBe(0);
    expect(c.toolDecisionsRejected).toBe(0);
    expect(c.commitCount).toBe(0);
    expect(c.prCount).toBe(0);
    expect(c.apiErrorCount).toBe(0);
    expect(c.modelUsage).toEqual({});
    expect(c.lastUpdate).toBe(0);
    expect(c.ingesterStarted).toBe(0);
  });

  it("OtelCountersSchema validates a fresh structure", () => {
    const c = createInitialOtelCounters();
    const result = OtelCountersSchema.safeParse(c);
    expect(result.success).toBe(true);
  });

  it("OtelCountersSchema rejects negative numbers", () => {
    const bad = { ...createInitialOtelCounters(), linesAdded: -1 };
    const result = OtelCountersSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it("OtelCountersSchema accepts modelUsage entries", () => {
    const c: OtelCounters = {
      ...createInitialOtelCounters(),
      modelUsage: {
        "claude-opus-4-7": { tokensIn: 500, tokensOut: 200, sessions: 3 },
      },
    };
    expect(OtelCountersSchema.safeParse(c).success).toBe(true);
  });

  it("ensureOtelCounters synthesizes counters.otel when absent (V1.x migration)", () => {
    const v1State: State = createInitialState(generatePet({ username: "u", hostname: "h" }), 0);
    delete (v1State.counters as { otel?: OtelCounters }).otel;
    expect(v1State.counters.otel).toBeUndefined();
    ensureOtelCounters(v1State);
    expect(v1State.counters.otel).toBeDefined();
    expect(v1State.counters.otel?.lastUpdate).toBe(0);
  });
});
