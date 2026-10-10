// Agent tools in the shape that foxloop takes (docs/failure-modes.md
// L1-L6). foxpass does not import foxloop: any loop with the same tool
// shape works. Summaries are text that foxpass writes. Page text goes only
// in `untrusted`, and its secret values are redacted.
import { FoxpassError } from "./errors.js";
import type { Handoff, HandoffRequest, HandoffResult } from "./handoff.js";
import { readTab, scanTab, type ScanBrowser } from "./scan.js";
import type { PageSnapshot } from "./types.js";

export interface CheckResult {
  ok: boolean;
  checks: { part: string; ok: boolean; evidence: string }[];
}

export interface ToolOutput {
  ok: boolean;
  summary: string;
  untrusted?: string;
  data?: unknown;
  check?: CheckResult;
}

/** A foxloop `LoopTool`, with scope `read`: neither tool types, clicks, or sends. */
export interface AgentTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  scope: "read";
  domain: (args: Record<string, unknown>) => Promise<string>;
  run: (args: Record<string, unknown>, ctx: { signal: AbortSignal }) => Promise<ToolOutput>;
}

export interface TabBrowser extends ScanBrowser {
  tabs: { get(tabId: number): Promise<{ url?: string }> };
}

async function hostOfTab(browser: TabBrowser, tabId: number): Promise<string> {
  const tab = await browser.tabs.get(tabId).catch(() => undefined);
  if (!tab?.url) throw new FoxpassError("no-tab", "The tab is gone, or foxpass cannot see its address.");
  return new URL(tab.url).hostname;
}

const SUMMARIES: Record<Exclude<HandoffResult["status"], "signed-in">, string> = {
  "no-wall": "No sign-in step on this page.",
  timeout: "The user did not finish the sign-in step in time. Stop, and tell the user.",
  "tab-closed": "The user closed the tab. Stop, and tell the user.",
  cancelled: "The run stopped while the user signed in.",
  busy: "The user already works on a sign-in step in this tab. Wait, then read the page again.",
};

/**
 * `hand_to_user`: pause the run and let the user do the auth step. The
 * model can pass only a short reason, never a selector or a value (L5).
 */
export function handoffTool(options: { handoff: Pick<Handoff, "toUser">; browser: TabBrowser; tabId: () => number; request?: Omit<HandoffRequest, "tabId" | "signal" | "walls"> }): AgentTool {
  return {
    name: "hand_to_user",
    description: "Call this when the page asks for a password, a code, a passkey, a CAPTCHA, or OAuth consent. The user does that step. You never type passwords or codes.",
    parameters: { type: "object", properties: { reason: { type: "string", maxLength: 200 } }, additionalProperties: false },
    scope: "read",
    domain: () => hostOfTab(options.browser, options.tabId()),
    async run(_args, ctx) {
      const result = await options.handoff.toUser({ ...options.request, tabId: options.tabId(), signal: ctx.signal });
      if (result.status === "signed-in") return { ok: true, summary: `The user finished the sign-in step on ${result.host}. Read the page again before you go on.`, data: result };
      return { ok: result.status === "no-wall", summary: SUMMARIES[result.status], data: result };
    },
  };
}

/**
 * `read_page`: read the tab with secret values redacted, and say when the
 * page has a step that only the user can do. Pass `check` to tell foxloop
 * when the page shows that the goal is met.
 */
export function readPageTool(options: { browser: TabBrowser; tabId: () => number; check?: (snapshot: PageSnapshot) => CheckResult | undefined }): AgentTool {
  return {
    name: "read_page",
    description: "Read the current page: its text and its fields. Password and code values show as [redacted].",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    scope: "read",
    domain: () => hostOfTab(options.browser, options.tabId()),
    async run() {
      const tabId = options.tabId();
      const [snapshot, scan] = await Promise.all([readTab(options.browser, tabId), scanTab(options.browser, tabId)]);
      const kinds = [...new Set(scan.walls.map((w) => w.kind))];
      const summary = kinds.length
        ? `The page has a step that only the user can do: ${kinds.join(", ")}. Call hand_to_user. Do not type into these fields.`
        : "Read the page. It has no sign-in step.";
      const untrusted = JSON.stringify({ ...snapshot, walls: scan.walls.map((w) => ({ kind: w.kind, reason: w.reason })) });
      const check = options.check?.(snapshot);
      return check ? { ok: true, summary, untrusted, check } : { ok: true, summary, untrusted };
    },
  };
}
