// The E2E build's background: the demo, plus messages that only the E2E
// tests send. scripts/build-ext.mjs --e2e bundles this file in place of
// extension/background.js, so none of it reaches dist-ext/.
import { createFoxgate } from "foxgate";
import { FILL_TOOL, createVault } from "foxvault";
import { createDemo } from "../../demo/core.js";
import { fillWall, handoffTool, readTab, scanTab } from "../../src/index.ts";

const demo = createDemo(browser);
const { handoff, events, runOfTab, agents } = demo;
const results = new Map();
const controllers = new Map();
let notifyThrows = false;
demo.hooks.beforeNotice = () => {
  if (notifyThrows) throw new Error("notify is down");
};

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


// V1-V4: a foxvault secret for the sample bank, filled only after an
// approval of the exact host and field.
const fillGate = createFoxgate({ tools: { [FILL_TOOL]: "fill" } });
const vault = createVault({ gate: fillGate.gate, browser });
const vaultReady = (async () => {
  await vault.initialize();
  await vault.set("vault:acorn-password", "correct horse", { domains: ["localhost"], allowHttp: true });
  await fillGate.host.addGrant({ scope: "fill", domains: ["localhost"], tools: [FILL_TOOL], approval: "always" });
})();
async function fillFromVault(message) {
  await vaultReady;
  const scan = await scanTab(browser, message.tabId);
  const wall = message.kind ? { kind: message.kind } : (scan.walls.find((w) => w.selector === message.selector) ?? { kind: "password", selector: message.selector });
  if (message.reloadFirst) {
    await browser.tabs.reload(message.tabId);
    // Wait for the new document, not only for "complete": the old one is complete too.
    const fresh = async () => (await browser.webNavigation.getFrame({ tabId: message.tabId, frameId: 0 }))?.documentId !== scan.documentId && (await browser.tabs.get(message.tabId)).status === "complete";
    for (let i = 0; i < 50 && !(await fresh()); i++) await new Promise((r) => setTimeout(r, 100));
  }
  const request = { vault, handle: "vault:acorn-password", tabId: message.tabId, scan, wall };
  if (message.reloadFirst) {
    // The user approves at once, so the fill reaches foxvault's page check.
    const asked = await fillWall(request);
    if (asked.status !== "ask") return asked;
    return fillWall({ ...request, token: await fillGate.host.approve(asked.requestId) });
  }
  const token = message.approve ? await fillGate.host.approve(message.approve) : undefined;
  return fillWall({ ...request, token });
}

const toolFor = (tabId) => handoffTool({ handoff, browser, tabId: () => tabId });

browser.runtime.onMessage.addListener(async (message) => {
  if (message?.type === "ready") return demo.ready.then(() => true);
  if (message?.type === "scan") return scanTab(browser, message.tabId);
  if (message?.type === "read") return readTab(browser, message.tabId);
  if (message?.type === "handoff") return startHandoff(message);
  if (message?.type === "handoff-result") return results.get(message.id) ?? null;
  if (message?.type === "cancel") return controllers.get(message.id)?.abort() ?? true;
  if (message?.type === "events") return events;
  if (message?.type === "fill-wall") return fillFromVault(message);
  if (message?.type === "fill-pending") return fillGate.host.pending();
  if (message?.type === "agent") return demo.startAgent(message);
  if (message?.type === "agent-state") return demo.agentState(message.id);
  if (message?.type === "agent-planner") return agents.get(message.id)?.seen ?? null;
  if (message?.type === "agent-cancel") return agents.get(message.id)?.controller.abort() ?? true;
  if (message?.type === "tool") return toolFor(message.tabId).run({}, { signal: new AbortController().signal }).then(({ ok, summary }) => ({ ok, summary }));
  if (message?.type === "tool-domain") return toolFor(message.tabId).domain({}).then(() => "returned", () => "throws");
  if (message?.type === "tool-schema") return toolFor(0).parameters;
  return demo.handlePopup(message);
});
