// Tests for docs/failure-modes.md H17. Written before src/handoff.ts. The
// other handoff failure modes need a browser: see e2e/run.mjs.
import { describe, expect, it } from "vitest";
import { createHandoff, FoxpassError, type HandoffBrowser } from "../src/index.js";

const browser = {} as HandoffBrowser;
const codeOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return error instanceof FoxpassError ? error.code : "other";
  }
  return "none";
};

describe("createHandoff options", () => {
  it("H17 refuses a timeout outside 1 s to 30 min", () => {
    for (const timeoutMs of [999, 30 * 60_000 + 1, Number.NaN, Infinity]) expect(codeOf(() => createHandoff({ browser, timeoutMs }))).toBe("bad-option");
    expect(codeOf(() => createHandoff({ browser, timeoutMs: 1000 }))).toBe("none");
  });
  it("H17 refuses a poll interval outside 100 ms to 10 s", () => {
    for (const pollMs of [99, 10_001, Number.NaN]) expect(codeOf(() => createHandoff({ browser, pollMs }))).toBe("bad-option");
    expect(codeOf(() => createHandoff({ browser, pollMs: 100 }))).toBe("none");
  });
});
