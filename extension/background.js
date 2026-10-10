// The demo background (an MV3 event page). It registers the passkey
// observer, scans tabs for auth walls, reads tabs with secrets redacted,
// and hands walls to the user.
import { createHandoff, readTab, registerWebAuthnObserver, scanTab } from "../src/index.ts";

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
  return undefined;
});
