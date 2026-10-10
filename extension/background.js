// The demo background (an MV3 event page). It registers the passkey
// observer, scans tabs for auth walls, reads tabs with secrets redacted,
// and hands walls to the user.
import { createHandoff, handoffTool, readTab, registerWebAuthnObserver, scanTab } from "../src/index.ts";
import { runAgent } from "../demo/agent.js";

const ready = registerWebAuthnObserver(browser, { js: "observer.js" });
// Events and notices, with the run id they belong to.
const events = [];
const results = new Map();
const controllers = new Map();
const runOfTab = new Map();
let notifyThrows = false;

const handoff = createHandoff({
  browser,
  pollMs: 250,
  onEvent: (event) => events.push({ run: runOfTab.get(event.tabId), ...event }),
  // A stand-in for foxnotify: keep the notice so the popup can show it.
  onNeedsUser: (notice) => {
    if (notifyThrows) throw new Error("notify is down");
    events.push({ run: runOfTab.get(notice.tabId), type: "notice", kind: notice.kind, host: notice.host, message: notice.message });
  },
});

function startHandoff(message) {
  if (!handoff.waiting().includes(message.tabId)) runOfTab.set(message.tabId, message.id);
  notifyThrows = message.notifyThrows === true;
  const controller = new AbortController();
  controllers.set(message.id, controller);
  const check = message.checkThrows
    ? () => {
        throw new Error("the check is broken");
      }
    : undefined;
  handoff
    .toUser({ tabId: message.tabId, walls: message.walls, cookie: message.cookie, check, timeoutMs: message.timeoutMs, signal: controller.signal })
    .then((result) => results.set(message.id, result));
  return true;
}

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
const toolFor = (tabId) => handoffTool({ handoff, browser, tabId: () => tabId });

browser.runtime.onInstalled.addListener(() => {
  browser.storage.local.set({ fixture: "installed" });
});

browser.runtime.onMessage.addListener(async (message) => {
  if (message?.type === "ready") return ready.then(() => true);
  if (message?.type === "scan") return scanTab(browser, message.tabId);
  if (message?.type === "read") return readTab(browser, message.tabId);
  if (message?.type === "handoff") return startHandoff(message);
  if (message?.type === "handoff-result") return results.get(message.id) ?? null;
  if (message?.type === "cancel") return controllers.get(message.id)?.abort() ?? true;
  if (message?.type === "events") return events;
  if (message?.type === "agent") return startAgent(message);
  if (message?.type === "agent-state") return agentState(message.id);
  if (message?.type === "agent-planner") return agents.get(message.id)?.seen ?? null;
  if (message?.type === "agent-cancel") return agents.get(message.id)?.controller.abort() ?? true;
  if (message?.type === "tool") return toolFor(message.tabId).run({}, { signal: new AbortController().signal }).then(({ ok, summary }) => ({ ok, summary }));
  if (message?.type === "tool-domain") return toolFor(message.tabId).domain({}).then(() => "returned", () => "throws");
  if (message?.type === "tool-schema") return toolFor(0).parameters;
  return undefined;
});
