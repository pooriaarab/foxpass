// Tests for docs/failure-modes.md H17 and H18. H17 was written before src/handoff.ts. The
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

// H18: the tab closes while the first scan runs. A failed scan is not "no
// wall". CI found this race: a closed tab ended as no-wall.
const PAGE = { url: "http://bank.example/login", title: "Sign in", headings: [], buttons: [], frames: [], captchaMarks: [], webauthn: [] };
const PASSWORD_FIELD = { selector: "#pw", tag: "input", type: "password", autocomplete: "", name: "", id: "pw", label: "", placeholder: "", inputMode: "", maxLength: -1, visible: true, filled: false, form: 0 };

function fakeBrowser(options: { scans: ("fail" | "wall" | "none")[]; tabGoneAfterGets?: number; removeDuringFirstScan?: boolean }) {
  let gets = 0;
  let scans = 0;
  const removed: ((tabId: number) => void)[] = [];
  const fake = {
    tabs: {
      get: async () => {
        gets += 1;
        if (options.tabGoneAfterGets !== undefined && gets > options.tabGoneAfterGets) throw new Error("Invalid tab ID");
        return { url: PAGE.url, status: "complete", windowId: 1 };
      },
      update: async () => ({}),
      onRemoved: { addListener: (fn: (tabId: number) => void) => removed.push(fn), removeListener: () => undefined },
    },
    windows: { update: async () => ({}) },
    webNavigation: { getFrame: async () => ({ url: PAGE.url, documentId: "doc-1" }) },
    scripting: {
      executeScript: async (injection: { func: { name: string } }) => {
        if (injection.func.name !== "scanPage") return [{}];
        const next = options.scans[Math.min(scans, options.scans.length - 1)];
        scans += 1;
        if (scans === 1 && options.removeDuringFirstScan) for (const fn of removed) fn(7);
        if (next === "fail") throw new Error("Missing host permission for the tab, or the tab is closing");
        return [{ result: { ...PAGE, fields: next === "wall" ? [PASSWORD_FIELD] : [] } }];
      },
    },
  };
  return fake as unknown as HandoffBrowser;
}

describe("a tab that closes during the first scan", () => {
  it("H18 a failed first scan of a tab that is then gone ends tab-closed, not no-wall", async () => {
    const handoff = createHandoff({ browser: fakeBrowser({ scans: ["fail"], tabGoneAfterGets: 1 }), pollMs: 100 });
    expect(await handoff.toUser({ tabId: 7 })).toEqual({ status: "tab-closed" });
  });
  it("H18 a tab that Firefox removes during the first scan ends tab-closed, also when tabs.get still answers", async () => {
    const handoff = createHandoff({ browser: fakeBrowser({ scans: ["fail"], removeDuringFirstScan: true }), pollMs: 100 });
    expect(await handoff.toUser({ tabId: 7 })).toEqual({ status: "tab-closed" });
  });
  it("H18 a first scan that fails once and then finds a wall starts the handoff", async () => {
    const events: string[] = [];
    const controller = new AbortController();
    const handoff = createHandoff({ browser: fakeBrowser({ scans: ["fail", "wall"] }), pollMs: 100, onEvent: (e) => events.push(e.type) });
    const result = handoff.toUser({ tabId: 7, signal: controller.signal });
    for (let i = 0; i < 50 && !events.includes("paused"); i++) await new Promise((r) => setTimeout(r, 20));
    controller.abort();
    expect(await result).toEqual({ status: "cancelled" });
    expect(events.slice(0, 2)).toEqual(["scan-failed", "paused"]);
  });
  it("H12 a scan that works and finds no wall still ends no-wall at once", async () => {
    const handoff = createHandoff({ browser: fakeBrowser({ scans: ["none"] }), pollMs: 100 });
    expect(await handoff.toUser({ tabId: 7 })).toEqual({ status: "no-wall" });
  });
});
