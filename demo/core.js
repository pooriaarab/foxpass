// The demo's background logic, shared by the release build
// (extension/background.js) and the E2E build (e2e/extension/background.js).
// It registers the passkey observer, runs the demo agent for the popup, and
// hands walls to the user. The toolbar badge shows while the agent waits.
import { createHandoff, registerWebAuthnObserver } from "../src/index.ts";
import { runAgent } from "./agent.js";

// One line in the popup for each foxloop event that the user cares about.
function stepLine(event) {
  if (event.type === "tool-call") return `Calls ${event.name}`;
  if (event.type === "tool-result") return `${event.name}: ${event.summary}`;
  if (event.type === "done") return `Done: ${event.summary}`;
  if (event.type === "blocked") return `Stopped: ${event.reason}`;
  if (event.type === "aborted") return "Stopped by you";
  return null;
}

export function createDemo(browser) {
  /** Test hooks. The release build sets none. */
  const hooks = {};
  const ready = registerWebAuthnObserver(browser, { js: "observer.js" });
  // Events and notices, with the run id they belong to.
  const events = [];
  const runOfTab = new Map();

  const handoff = createHandoff({
    browser,
    pollMs: 250,
    onEvent: (event) => {
      events.push({ run: runOfTab.get(event.tabId), ...event });
      // The toolbar badge shows that the agent waits for the user.
      if (event.type === "paused" || event.type === "wall-changed") {
        browser.action.setBadgeText({ tabId: event.tabId, text: "!" });
        browser.action.setBadgeBackgroundColor({ tabId: event.tabId, color: "#ff9500" });
      }
      if (event.type === "ended") browser.action.setBadgeText({ tabId: event.tabId, text: "" }).catch(() => undefined);
    },
    // A stand-in for foxnotify: keep the notice so the popup can show it.
    onNeedsUser: (notice) => {
      hooks.beforeNotice?.(notice);
      events.push({ run: runOfTab.get(notice.tabId), type: "notice", kind: notice.kind, host: notice.host, message: notice.message });
    },
  });

  // Agent runs: foxloop events, the end state, and what the planner saw.
  const agents = new Map();
  function startAgent(message) {
    const run = { events: [], status: "running", summary: "", seen: [], controller: new AbortController() };
    agents.set(message.id, run);
    runOfTab.set(message.tabId, message.id);
    runAgent({ browser, handoff, tabId: message.tabId, signal: run.controller.signal, handoffTimeoutMs: message.handoffTimeoutMs, onEvent: (event) => run.events.push(event) })
      .then(({ last, seen }) => Object.assign(run, { status: last.type, summary: last.summary ?? last.reason ?? "", seen }))
      .catch((error) => Object.assign(run, { status: "error", summary: String(error) }));
    return true;
  }
  function agentState(id) {
    const run = agents.get(id);
    if (!run) return null;
    const steps = events.filter((e) => e.run === id && ["paused", "wall-changed", "ended"].includes(e.type));
    const latest = steps.at(-1);
    const waiting = latest && latest.type !== "ended" ? latest.walls[0].kind : null;
    return { events: run.events, status: run.status, summary: run.summary, waiting };
  }
  // The popup: one agent run for each tab, started with Run.
  const latest = new Map();
  let popupRuns = 0;
  async function popupState(tabId) {
    const tab = await browser.tabs.get(tabId);
    const origin = `${new URL(tab.url).protocol}//${new URL(tab.url).hostname}/*`;
    const permitted = await browser.permissions.contains({ origins: [origin] });
    const state = latest.has(tabId) ? agentState(latest.get(tabId)) : null;
    return {
      host: new URL(tab.url).host,
      permitted,
      status: state?.status ?? null,
      summary: state?.summary ?? "",
      waiting: state?.waiting ?? null,
      steps: (state?.events ?? []).map(stepLine).filter(Boolean).slice(-8),
    };
  }
  function runFromPopup(tabId) {
    const id = `popup-${++popupRuns}`;
    latest.set(tabId, id);
    return startAgent({ id, tabId });
  }

  /** The messages that the popup sends. Others get undefined. */
  async function handlePopup(message) {
    if (message?.type === "popup-state") return popupState(message.tabId);
    if (message?.type === "run") return runFromPopup(message.tabId);
    if (message?.type === "stop") return agents.get(latest.get(message.tabId))?.controller.abort() ?? true;
    return undefined;
  }

  return { ready, hooks, handoff, events, runOfTab, agents, startAgent, agentState, handlePopup };
}
