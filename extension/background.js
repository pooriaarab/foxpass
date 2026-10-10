// The demo background (an MV3 event page). It registers the passkey
// observer and scans tabs for auth walls.
import { registerWebAuthnObserver, scanTab } from "../src/index.ts";

const ready = registerWebAuthnObserver(browser, { js: "observer.js" });

browser.runtime.onInstalled.addListener(() => {
  browser.storage.local.set({ fixture: "installed" });
});

browser.runtime.onMessage.addListener((message) => {
  if (message?.type === "ready") return ready.then(() => true);
  if (message?.type === "scan") return scanTab(browser, message.tabId);
  return undefined;
});
