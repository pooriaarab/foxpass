// The passkey E2E test. Firefox waits for a USB security key, so the
// page's WebAuthn call stays pending, as it does for a real user. The test
// then acts as the user: it switches Firefox to a virtual authenticator
// (Marionette WebAuthn commands), adds a passkey, and clicks "Use a passkey".
// Checks P1-P4 in docs/failure-modes.md. Writes artifacts/e2e-passkey-<date>.json.
// Usage: node e2e/passkey.mjs [--headed], after build-ext.mjs --e2e.
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { serve, writeArtifact } from "create-foxkit/e2e";
import { launchMarionette } from "./lib/marionette.mjs";

const record = { startedAt: new Date().toISOString(), checks: [] };
const check = (name, expected, actual) => record.checks.push({ name, expected, actual, ok: JSON.stringify(actual) === JSON.stringify(expected) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, timeoutMs = 20000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn().catch(() => undefined);
    if (value) return value;
    if (Date.now() > end) throw new Error(`timed out: ${fn}`);
    await sleep(200);
  }
}

const CREDENTIAL_ID = randomBytes(16).toString("base64url");
const site = await serve("demo/site");
const base = site.url.replace("127.0.0.1", "localhost");
let fox;
try {
  fox = await launchMarionette({
    headless: !process.argv.includes("--headed"),
    // A USB key that never comes: the passkey request waits for the user.
    prefs: { "security.webauth.webauthn_enable_softtoken": false, "security.webauth.webauthn_enable_usbtoken": true, "security.webauthn.enable_macos_passkeys": false },
  });
  record.firefox = fox.version;
  const id = await fox.send("Addon:Install", { path: resolve("dist-e2e"), temporary: true });
  const uuid = await fox.run("return WebExtensionPolicy.getByID(arguments[0]).mozExtensionHostname;", [id], "chrome");
  const extHandle = await fox.send("WebDriver:GetWindowHandle");
  await fox.send("WebDriver:Navigate", { url: `moz-extension://${uuid}/popup.html` });
  const send = (message) => fox.run("return await browser.runtime.sendMessage(arguments[0]);", [message]);
  const inExt = async (fn) => {
    await fox.send("WebDriver:SwitchToWindow", { handle: extHandle });
    return fn();
  };
  await send({ type: "ready" });

  const siteHandle = (await fox.send("WebDriver:NewWindow", { type: "tab" })).handle;
  const inSite = async (script, args = []) => {
    await fox.send("WebDriver:SwitchToWindow", { handle: siteHandle });
    return fox.run(script, args);
  };
  await fox.send("WebDriver:SwitchToWindow", { handle: siteHandle });
  await fox.send("WebDriver:Navigate", { url: `${base}/passkey.html` });
  const tabId = await until(() => inExt(() => fox.run("return (await browser.tabs.query({})).find((t) => t.url?.startsWith(arguments[0]))?.id;", [`${base}/passkey.html`])));

  // P1: the pending passkey request is a wall.
  const scan = await inExt(() => send({ type: "scan", tabId }));
  check("P1 a passkey request that waits is a webauthn wall", ["webauthn"], scan.walls.map((w) => w.kind));
  check("P1 the reason names the RP ID", true, scan.walls[0]?.reason.includes("RP ID localhost"));
  check("P3 the observer record holds the call, not its result", [["at", "conditional", "kind", "rpId", "state"]], scan.scan.webauthn.map((c) => Object.keys(c).toSorted()));

  // The agent reads the page, sees the wall, and hands it to the user.
  await inExt(() => send({ type: "agent", id: "passkey-1", tabId }));
  const waiting = await until(() => inExt(() => send({ type: "agent-state", id: "passkey-1" }).then((s) => s.waiting)));
  check("P1 the agent waits for the user on the passkey step", "webauthn", waiting);
  const banner = await until(() => inSite("return document.getElementById('foxpass-banner')?.shadowRoot?.textContent ?? null;"));
  check("P1 the banner tells the user to use a passkey", true, banner.includes("passkey"));

  // The test acts as the user: a passkey on a virtual authenticator, then a click.
  await fox.run("Services.prefs.setBoolPref('security.webauth.webauthn_enable_softtoken', true); Services.prefs.setBoolPref('security.webauth.webauthn_enable_usbtoken', false);", [], "chrome");
  const authenticatorId = await fox.send("WebAuthn:AddVirtualAuthenticator", { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true });
  const privateKey = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ format: "der", type: "pkcs8" }).toString("base64url");
  await fox.send("WebAuthn:AddCredential", { authenticatorId, credentials: { credentialId: CREDENTIAL_ID, isResidentCredential: true, rpId: "localhost", privateKey, userHandle: Buffer.from("ada").toString("base64url"), signCount: 0 } });
  await inSite("document.getElementById('retry').click(); return true;");

  // P2, P4: the ceremony works through the observer, and the agent goes on.
  const state = await until(() => inExt(() => send({ type: "agent-state", id: "passkey-1" }).then((s) => (s.status === "running" ? null : s))), 30000);
  check("P4 the agent goes on after the passkey and reads the balance", { status: "done", summary: "Your balance is $1,204.56." }, { status: state.status, summary: state.summary });
  const handResult = state.events.find((e) => e.type === "tool-result" && e.name === "hand_to_user");
  check("P4 hand_to_user passed", true, handResult?.ok);
  const events = await inExt(() => send({ type: "events" }));
  check("P4 the handoff ended signed in", "signed-in", events.find((e) => e.run === "passkey-1" && e.type === "ended")?.status);
  const planner = await inExt(() => send({ type: "agent-planner", id: "passkey-1" }));
  check("P3 the planner context holds no credential ID", false, JSON.stringify(planner).includes(CREDENTIAL_ID));
  check("P3 the agent events hold no credential ID", false, JSON.stringify(state.events).includes(CREDENTIAL_ID));
  const credentials = await fox.send("WebAuthn:GetCredentials", { authenticatorId });
  check("P2 the virtual authenticator signed one assertion", 1, credentials[0]?.signCount);
} catch (error) {
  record.error = error instanceof Error ? error.message : String(error);
} finally {
  await fox?.close();
  await site.close();
}
record.passed = !record.error && record.checks.length > 0 && record.checks.every((c) => c.ok);
const path = writeArtifact("artifacts", "e2e-passkey", record);
for (const c of record.checks) console.log(`${c.ok ? "ok " : "BAD"} ${c.name}${c.ok ? "" : `: wanted ${JSON.stringify(c.expected)}, got ${JSON.stringify(c.actual)}`}`);
console.log(`${record.passed ? "PASS" : "FAIL"} ${record.checks.filter((c) => c.ok).length}/${record.checks.length}${record.error ? `: ${record.error}` : ""} | ${path}`);
process.exitCode = record.passed ? 0 : 1;
