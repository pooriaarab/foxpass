// Hand an auth wall to the user: bring the tab to the front, show what to
// do, and wait until the user signs in (docs/failure-modes.md H1-H17).
// Nothing here reads a field value, so no event can hold one (H14).
import { FoxpassError } from "./errors.js";
import { clearBanner, showBanner } from "./page/highlight.js";
import { scanTab, type ScanBrowser } from "./scan.js";
import type { Wall, WallKind } from "./types.js";

/** The parts of the WebExtension `browser` object that a handoff uses. */
export interface HandoffBrowser extends ScanBrowser {
  tabs: {
    get(tabId: number): Promise<{ url?: string; status?: string; windowId?: number }>;
    update(tabId: number, change: { active: true }): Promise<unknown>;
  };
  windows: { update(windowId: number, change: { focused: true }): Promise<unknown> };
  /** Needed only for the cookie signal. */
  cookies?: { get(details: { url: string; name: string }): Promise<{ value: string } | null> };
}

/** What the notify hook gets, for example to send a foxnotify alert. */
export interface Notice {
  tabId: number;
  host: string;
  kind: WallKind;
  message: string;
  walls: Wall[];
}

export type HandoffEvent =
  | { type: "paused" | "wall-changed"; tabId: number; at: number; walls: Wall[] }
  | { type: "resumed"; tabId: number; at: number; signal: SignInSignal }
  | { type: "notify-failed" | "highlight-failed" | "check-failed" | "scan-failed"; tabId: number; at: number }
  | { type: "ended"; tabId: number; at: number; status: HandoffResult["status"] };

export type SignInSignal = "url-changed" | "form-gone" | "cookie" | "check";

export type HandoffResult = { status: "signed-in"; signal: SignInSignal; host: string } | { status: "timeout" | "tab-closed" | "cancelled" | "busy" | "no-wall" };

export interface HandoffOptions {
  browser: HandoffBrowser;
  /** How long the user has, in ms. 1 s to 30 min. Default: 5 min. */
  timeoutMs?: number;
  /** How often foxpass looks at the tab, in ms. 100 ms to 10 s. Default: 500 ms. */
  pollMs?: number;
  /** Tell the user outside the page, for example with foxnotify. If it throws, the handoff goes on. */
  onNeedsUser?: (notice: Notice) => void | Promise<void>;
  onEvent?: (event: HandoffEvent) => void;
  now?: () => number;
}

export interface HandoffRequest {
  tabId: number;
  /** The walls to hand off. Default: scan the tab now. */
  walls?: Wall[];
  /** Other hosts that count as signed in, for example the site after a sign-in on its identity host. */
  hosts?: string[];
  /** A cookie that appears or changes when the user signs in. */
  cookie?: { url: string; name: string };
  /** Your own test. A throw counts as "not yet". */
  check?: (tabId: number) => boolean | Promise<boolean>;
  signal?: AbortSignal;
  timeoutMs?: number;
}

const MESSAGES: Record<WallKind, string> = {
  password: "Type your password in the outlined field, then send the form.",
  otp: "Enter the code that you got in the outlined field, then send it.",
  "sign-in": "Sign in on this page. Start in the outlined field.",
  webauthn: "Use your passkey or your security key when Firefox asks.",
  captcha: "Solve the check on this page.",
  "oauth-consent": "Read what this app asks for, then allow or deny it yourself.",
};

/** The words foxpass shows the user for a wall. */
export const messageFor = (wall: Wall) => MESSAGES[wall.kind];

const within = (value: number | undefined, fallback: number, min: number, max: number, name: string) => {
  const v = value ?? fallback;
  if (!Number.isFinite(v) || v < min || v > max) throw new FoxpassError("bad-option", `${name} must be from ${min} to ${max} ms.`);
  return v;
};
const keyOf = (walls: Wall[]) => walls.map((w) => `${w.kind} ${w.selector ?? ""}`).join("|");
const pageOf = (url: string) => {
  const u = new URL(url);
  return `${u.origin}${u.pathname}`;
};

export function createHandoff(options: HandoffOptions) {
  const timeoutMs = within(options.timeoutMs, 5 * 60_000, 1000, 30 * 60_000, "timeoutMs");
  const pollMs = within(options.pollMs, 500, 100, 10_000, "pollMs");
  const { browser } = options;
  const now = options.now ?? Date.now;
  const waiting = new Set<number>();
  const emit = (event: HandoffEvent) => {
    try {
      options.onEvent?.(event);
    } catch {
      // A listener that throws does not change the handoff.
    }
  };

  async function toUser(request: HandoffRequest): Promise<HandoffResult> {
    const { tabId, signal } = request;
    const limit = within(request.timeoutMs, timeoutMs, 1000, 30 * 60_000, "timeoutMs");
    if (waiting.has(tabId)) return { status: "busy" };
    waiting.add(tabId);
    let status = "tab-closed" as HandoffResult["status"];
    const end = (final: Exclude<HandoffResult["status"], "signed-in">): HandoffResult => {
      status = final;
      return { status: final };
    };
    try {
      const tab = await browser.tabs.get(tabId).catch(() => undefined);
      if (!tab?.url) return end("tab-closed");
      const start = { page: pageOf(tab.url), host: new URL(tab.url).hostname };
      const initial = await scanTab(browser, tabId).catch(() => undefined);
      let walls = request.walls ?? initial?.walls ?? [];
      if (walls.length === 0) return end("no-wall");
      let lastDocument = initial?.documentId;
      const cookieAt = request.cookie ? ((await browser.cookies?.get(request.cookie).catch(() => null))?.value ?? null) : null;
      try {
        await browser.tabs.update(tabId, { active: true });
        if (tab.windowId !== undefined) await browser.windows.update(tab.windowId, { focused: true });
      } catch {
        return end("tab-closed");
      }
      const highlight = async (documentId?: string) => {
        const wall = walls[0] as Wall;
        try {
          await browser.scripting.executeScript({ target: documentId ? { tabId, documentIds: [documentId] } : { tabId }, func: showBanner, args: [wall.selector ?? null, messageFor(wall)] });
        } catch {
          emit({ type: "highlight-failed", tabId, at: now() });
        }
      };
      await highlight(lastDocument);
      const first = walls[0] as Wall;
      void Promise.resolve()
        .then(() => options.onNeedsUser?.({ tabId, host: first.host, kind: first.kind, message: messageFor(first), walls }))
        .catch(() => emit({ type: "notify-failed", tabId, at: now() }));
      emit({ type: "paused", tabId, at: now(), walls });

      const began = now();
      let candidate: SignInSignal | undefined;
      const done = (signalName: SignInSignal, host: string): HandoffResult => {
        status = "signed-in";
        emit({ type: "resumed", tabId, at: now(), signal: signalName });
        return { status: "signed-in", signal: signalName, host };
      };
      for (;;) {
        if (signal?.aborted) return end("cancelled");
        if (now() - began >= limit) return end("timeout");
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, pollMs);
          signal?.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
        });
        if (signal?.aborted) continue;
        const current = await browser.tabs.get(tabId).catch(() => undefined);
        if (!current?.url) return end("tab-closed");
        const host = new URL(current.url).hostname;
        if (request.cookie && browser.cookies) {
          const value = (await browser.cookies.get(request.cookie).catch(() => null))?.value ?? null;
          if (value !== null && value !== cookieAt) return done("cookie", host);
        }
        if (request.check) {
          try {
            if (await request.check(tabId)) return done("check", host);
          } catch {
            emit({ type: "check-failed", tabId, at: now() });
          }
        }
        if (current.status !== "complete") continue;
        const scan = await scanTab(browser, tabId).catch(() => undefined);
        if (!scan) {
          emit({ type: "scan-failed", tabId, at: now() });
          continue;
        }
        if (scan.walls.length > 0) {
          candidate = undefined;
          const changed = keyOf(scan.walls) !== keyOf(walls);
          if (changed || scan.documentId !== lastDocument) {
            walls = scan.walls;
            lastDocument = scan.documentId;
            await highlight(scan.documentId);
            if (changed) emit({ type: "wall-changed", tabId, at: now(), walls });
          }
          continue;
        }
        const sameHost = host === start.host || (request.hosts ?? []).includes(host);
        const next: SignInSignal | undefined = !sameHost ? undefined : pageOf(current.url) === start.page ? "form-gone" : "url-changed";
        // Two scans in a row must agree, so a page that is still drawing its form does not count.
        if (next !== undefined && next === candidate) return done(next, host);
        candidate = next;
      }
    } finally {
      waiting.delete(tabId);
      if (status !== "no-wall") await browser.scripting.executeScript({ target: { tabId }, func: clearBanner }).catch(() => undefined);
      emit({ type: "ended", tabId, at: now(), status });
    }
  }

  return Object.freeze({
    toUser,
    /** The tabs that wait for the user now. */
    waiting: () => [...waiting],
  });
}

export type Handoff = ReturnType<typeof createHandoff>;
