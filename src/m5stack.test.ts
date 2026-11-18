import { describe, expect, it, vi } from "vitest";
import { ShakeLineDecoder, ShakeRollGate } from "./m5stack";

describe("M5Stack shake input", () => {
  it("decodes complete SHAKE lines across fragmented serial chunks", () => {
    const decoder = new ShakeLineDecoder();
    expect(decoder.push("SHA")).toBe(0);
    expect(decoder.push("KE\r\nnoise\nshake\n")).toBe(2);
  });

  it("allows one eligible roll per turn and ignores out-of-turn shakes", () => {
    const gate = new ShakeRollGate();
    const roll = vi.fn();
    expect(gate.tryRoll("turn-1", false, roll)).toBe(false);
    expect(gate.tryRoll("turn-1", true, roll)).toBe(true);
    expect(gate.tryRoll("turn-1", true, roll)).toBe(false);
    expect(gate.tryRoll("turn-2", true, roll)).toBe(true);
    expect(roll).toHaveBeenCalledTimes(2);
  });
});
