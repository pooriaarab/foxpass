// The E2E test: install dist-e2e/ in a real Firefox, serve demo/site/ on
// localhost, and check the failure modes in docs/failure-modes.md that only
// a browser can show. Writes artifacts/e2e-<date>.json.
// Usage: pnpm e2e [--headed]. Env: FIREFOX (the Firefox binary).
import { launch, poll, serve, writeArtifact } from "create-foxkit/e2e";

const PASSWORD = "correct horse";
const EMAIL = "ada@example.com";
const CODE = "424242";
const SECRETS = [PASSWORD, EMAIL, CODE];

const record = { startedAt: new Date().toISOString(), checks: [] };
const check = (name, expected, actual) => record.checks.push({ name, expected, actual, ok: JSON.stringify(actual) === JSON.stringify(expected) });
const kinds = (result) => result.walls.map((w) => `${w.kind}${w.selector ? ` ${w.selector}` : ""}`);
const banner = (page) => page.evaluate(() => document.getElementById("foxpass-banner")?.shadowRoot?.textContent ?? null);
const leaks = (value) => SECRETS.filter((s) => JSON.stringify(value).includes(s));

// The demo has no host access in the release build. The E2E build adds
// localhost, and WebAuthn needs a host name, not an IP address.
const site = await serve("demo/site");
const base = site.url.replace("127.0.0.1", "localhost");
let fox;
try {
  fox = await launch({
    extension: "dist-e2e",
    headless: !process.argv.includes("--headed"),
    // No USB key and no macOS passkeys: a WebAuthn call fails at once instead of opening a system dialog.
    prefs: { "security.webauth.webauthn_enable_softtoken": true, "security.webauth.webauthn_enable_usbtoken": false, "security.webauthn.enable_macos_passkeys": false },
  });
  record.firefox = await fox.browser.version();
  const ext = await fox.openExtensionPage("popup.html");
  const send = (message) => ext.evaluate((m) => browser.runtime.sendMessage(m), message);
  await send({ type: "ready" });
  const tabOf = (path) => poll(ext, async (url) => (await browser.tabs.query({})).find((t) => t.url?.startsWith(url))?.id, `${base}/${path}`);
  const scanOf = async (path) => send({ type: "scan", tabId: await tabOf(path) });

  // C1, C2, S1, S2: the scan sees the password field and never the typed text.
  const login = await fox.open(`${base}/login.html`);
  await login.type("#email", EMAIL);
  await login.type("#password", PASSWORD);
  const loginScan = await scanOf("login.html");
  check("C2 login page: one password wall, the hidden trap field is not one", ["password #password"], kinds(loginScan));
  check("S1 login scan holds no typed value", [], leaks(loginScan));
  check("S1 login scan says the password field is filled", true, loginScan.scan.fields.find((f) => f.selector === "#password")?.filled);
  const found = await login.evaluate((selectors) => selectors.map((s) => document.querySelectorAll(s).length), loginScan.scan.fields.map((f) => f.selector));
  check("S2 each field selector finds one element", true, found.length > 0 && found.every((n) => n === 1));
  // R1: what an agent reads has the password redacted, and the email as typed.
  const loginRead = await send({ type: "read", tabId: await tabOf("login.html") });
  check("R1 the agent's read of the login page holds no password", [], leaks(loginRead).filter((s) => s !== EMAIL));
  check("R1 the password field reads [redacted]", "[redacted]", loginRead.fields.find((f) => f.id === "password")?.value);
  check("R1 a plain field keeps its value", EMAIL, loginRead.fields.find((f) => f.id === "email")?.value);
  await login.close();

  // C4, S1: the OTP page.
  const otp = await fox.open(`${base}/otp.html`);
  await otp.type("#otp", CODE);
  const otpScan = await scanOf("otp.html");
  check("C4 OTP page: one otp wall", ["otp #otp"], kinds(otpScan));
  check("S1 OTP scan holds no typed value", [], leaks(otpScan));
  const otpRead = await send({ type: "read", tabId: await tabOf("otp.html") });
  check("R2 the agent's read of the OTP page holds no code", [], leaks(otpRead));
  check("R2 the OTP field reads [redacted]", "[redacted]", otpRead.fields.find((f) => f.id === "otp")?.value);
  await otp.close();

  // S3, S4: the observer sees a WebAuthn call that the page makes in <head>,
  // and the page still gets the browser's own answer.
  const passkey = await fox.open(`${base}/passkey.html`);
  const results = await poll(passkey, () => (window.passkeyResults.length ? window.passkeyResults : null));
  const passkeyScan = await scanOf("passkey.html");
  const call = passkeyScan.scan.webauthn[0];
  check("S4 the observer saw the early passkey call", { kind: "get", rpId: "localhost", conditional: false }, call && { kind: call.kind, rpId: call.rpId, conditional: call.conditional });
  check("S3 the page got the browser's own answer (no authenticator)", ["rejected:NotAllowedError"], results);
  check("S3 the record holds the end state, not the result", "rejected", call?.state);
  check("C10 a finished passkey call is not a wall", [], kinds(passkeyScan));
  await passkey.close();

  // C12, C14, C9, S5: the other walls, and a page with none.
  const captcha = await fox.open(`${base}/captcha.html`);
  check("C12 CAPTCHA page: a captcha wall", ["captcha"], kinds(await scanOf("captcha.html")));
  await captcha.close();
  const consent = await fox.open(`${base}/oauth/authorize.html?client_id=acorn-budget&scope=balance.read&response_type=code`);
  const consentScan = await scanOf("oauth/authorize.html");
  check("C14 consent page: an oauth-consent wall", ["oauth-consent"], kinds(consentScan));
  await consent.close();
  const plain = await fox.open(`${base}/plain.html`);
  const plainScan = await scanOf("plain.html");
  check("C9 newsletter page: no wall", [], kinds(plainScan));
  check("S5 the observer made no WebAuthn call by itself", [], plainScan.scan.webauthn);
  await plain.close();

  // The handoff. Each run gets an id. The background keeps its result, its
  // events, and the notices that the notify hook got.
  let runs = 0;
  const handoff = async (path, options = {}) => {
    const id = `run-${++runs}`;
    await send({ type: "handoff", id, tabId: await tabOf(path), ...options });
    return id;
  };
  const resultOf = (id, timeoutMs = 20000) => poll(ext, (i) => browser.runtime.sendMessage({ type: "handoff-result", id: i }), id, timeoutMs);
  const eventsOf = async (id) => (await send({ type: "events" })).filter((e) => e.run === id);
  const activeUrl = () => ext.evaluate(async () => (await browser.tabs.query({ active: true, lastFocusedWindow: true }))[0]?.url);

  // H12: no wall, no pause.
  const none = await fox.open(`${base}/plain.html?h=12`);
  check("H12 a page with no wall ends at once", { status: "no-wall" }, await resultOf(await handoff("plain.html?h=12")));
  await none.close();

  // H3, H4, H14, and the notify hook: password, then OTP, then the account page.
  const flow = await fox.open(`${base}/login.html?h=3`);
  // Put the extension page in front, so the handoff must bring the wall tab back.
  await ext.evaluate(async () => browser.tabs.update((await browser.tabs.getCurrent()).id, { active: true }));
  const flowRun = await handoff("login.html?h=3");
  check("H3 the wall tab comes to the front", `${base}/login.html?h=3`, await poll(ext, async (u) => ((await browser.tabs.query({ active: true, lastFocusedWindow: true }))[0]?.url === u ? u : null), `${base}/login.html?h=3`).catch(() => activeUrl()));
  check("H3 the banner tells the user what to do", true, (await poll(flow, () => document.getElementById("foxpass-banner")?.shadowRoot?.textContent ?? null)).includes("password"));
  check("H3 the password field is outlined", "true", await flow.evaluate(() => document.getElementById("password").dataset.foxpassHighlight ?? null));
  // The test now acts as the user.
  await flow.type("#email", EMAIL);
  await flow.type("#password", PASSWORD);
  await flow.click("button[type=submit]");
  await poll(flow, () => (location.pathname.endsWith("otp.html") && document.readyState === "complete") || null);
  check("H4 the OTP page is a new step, not a sign-in", true, await poll(ext, async (i) => ((await browser.runtime.sendMessage({ type: "events" })).some((e) => e.run === i && e.type === "wall-changed") ? true : null), flowRun));
  check("H4 the banner moves to the OTP step", true, (await poll(flow, () => document.getElementById("foxpass-banner")?.shadowRoot?.textContent ?? null)).includes("code"));
  await flow.type("#otp", CODE);
  await flow.click("button[type=submit]");
  const flowResult = await resultOf(flowRun);
  check("H3 signed in when the account page has no wall", { status: "signed-in", signal: "url-changed", host: "localhost" }, flowResult);
  const flowEvents = await eventsOf(flowRun);
  check("H4 the events show the steps in order", ["paused", "wall-changed", "resumed", "ended"], flowEvents.map((e) => e.type).filter((t) => t !== "notice"));
  check("H14 no event holds a typed value", [], leaks(flowEvents));
  check("notify hook got one notice for the password step", [{ kind: "password", host: "localhost" }], flowEvents.filter((e) => e.type === "notice").map((e) => ({ kind: e.kind, host: e.host })));
  await flow.close();

  // H2, H8: nobody signs in, and the notify hook throws.
  const idle = await fox.open(`${base}/login.html?h=2`);
  const idleRun = await handoff("login.html?h=2", { timeoutMs: 1500, notifyThrows: true });
  check("H2 the handoff times out", { status: "timeout" }, await resultOf(idleRun));
  check("H2 the banner is gone after the timeout", null, await banner(idle));
  check("H8 a notify hook that throws does not stop the handoff", true, (await eventsOf(idleRun)).some((e) => e.type === "notify-failed"));
  // H15: a second handoff on a tab that already waits.
  const busyRun = await handoff("login.html?h=2", { timeoutMs: 1500 });
  check("H15 a second handoff on one tab gets busy", { status: "busy" }, await resultOf(await handoff("login.html?h=2")));
  await resultOf(busyRun);
  // H11: the agent run stops.
  const cancelRun = await handoff("login.html?h=2", { timeoutMs: 60000 });
  await send({ type: "cancel", id: cancelRun });
  check("H11 an abort ends the handoff", { status: "cancelled" }, await resultOf(cancelRun));
  // H16: the user goes to another host that has no wall.
  const awayRun = await handoff("login.html?h=2", { timeoutMs: 2500 });
  await idle.goto(`${site.url}/plain.html`);
  check("H16 another host with no wall is not a sign-in", { status: "timeout" }, await resultOf(awayRun));
  // H1: the user closes the tab.
  const closing = await fox.open(`${base}/login.html?h=1`);
  const closeRun = await handoff("login.html?h=1", { timeoutMs: 60000 });
  await closing.close();
  check("H1 a closed tab ends the handoff", { status: "tab-closed" }, await resultOf(closeRun));
  await idle.close();

  // H5: the form goes away and the URL stays.
  const spa = await fox.open(`${base}/spa.html`);
  const spaRun = await handoff("spa.html");
  await spa.type("#password", PASSWORD);
  await spa.click("button[type=submit]");
  check("H5 a form that goes away is a sign-in", { status: "signed-in", signal: "form-gone", host: "localhost" }, await resultOf(spaRun));
  await spa.close();

  // H6, H7: only a cookie shows the sign-in, and the custom check throws.
  const remember = await fox.open(`${base}/remember.html`);
  const rememberRun = await handoff("remember.html", { cookie: { url: `${base}/`, name: "acorn_device" }, checkThrows: true });
  await new Promise((r) => setTimeout(r, 600));
  await remember.type("#otp", CODE);
  await remember.click("button[type=submit]");
  check("H6 a new cookie is a sign-in", { status: "signed-in", signal: "cookie", host: "localhost" }, await resultOf(rememberRun));
  check("H7 a check that throws does not stop the handoff", true, (await eventsOf(rememberRun)).some((e) => e.type === "check-failed"));
  await remember.close();

  // H10, H13: a tab that foxpass cannot script. The banner and the scans fail, and the handoff waits on.
  const blank = await fox.open(`data:text/html,<h1>No access</h1>`);
  const blankTab = await poll(ext, async () => (await browser.tabs.query({})).find((t) => t.url?.startsWith("data:"))?.id);
  const blankRun = `run-${++runs}`;
  await send({ type: "handoff", id: blankRun, tabId: blankTab, timeoutMs: 1500, walls: [{ kind: "password", reason: "given by the test", selector: "#password", host: "localhost" }] });
  check("H13 a banner that cannot go in does not stop the handoff", { status: "timeout" }, await resultOf(blankRun));
  const blankEvents = (await eventsOf(blankRun)).map((e) => e.type);
  check("H13 highlight-failed and H10 scan-failed are events", [true, true], [blankEvents.includes("highlight-failed"), blankEvents.includes("scan-failed")]);
  await blank.close();

  // The agent: a foxloop run with a fixed rule planner, the foxpass read
  // tool, and the foxpass handoff tool. The test acts as the user.
  const agentState = (id) => send({ type: "agent-state", id });
  const agentDone = (id, timeoutMs = 30000) => poll(ext, async (i) => {
    const state = await browser.runtime.sendMessage({ type: "agent-state", id: i });
    return state.status === "running" ? null : state;
  }, id, timeoutMs);
  const waitingFor = (id) => poll(ext, async (i) => {
    const state = await browser.runtime.sendMessage({ type: "agent-state", id: i });
    return state.waiting ? state : null;
  }, id);

  // L1: the full run. The planner never sees the password or the code.
  const bank = await fox.open(`${base}/login.html?l=1`);
  await send({ type: "agent", id: "agent-1", tabId: await tabOf("login.html?l=1") });
  check("L1 the agent pauses for the user on the password step", "password", (await waitingFor("agent-1")).waiting);
  await bank.type("#email", EMAIL);
  await bank.type("#password", PASSWORD);
  await bank.click("button[type=submit]");
  await poll(bank, () => (location.pathname.endsWith("otp.html") && document.readyState === "complete") || null);
  await bank.type("#otp", CODE);
  await bank.click("button[type=submit]");
  const agent1 = await agentDone("agent-1");
  check("L1 the agent goes on after the sign-in and reads the balance", { status: "done", summary: "Your balance is $1,204.56." }, { status: agent1.status, summary: agent1.summary });
  check("L1 the agent called the tools in order", ["read_page", "hand_to_user", "read_page"], agent1.events.filter((e) => e.type === "tool-call").map((e) => e.name));
  const planner = await send({ type: "agent-planner", id: "agent-1" });
  check("L1 the planner saw the pages", true, JSON.stringify(planner).includes("Balance: $1,204.56"));
  check("L1 the planner context holds no password and no code", [], leaks(planner).filter((v) => v !== EMAIL));
  check("L1 the agent events hold no password and no code", [], leaks(agent1.events).filter((v) => v !== EMAIL));
  await bank.close();

  // L2: nobody signs in. L6: the run stops while the user signs in.
  const slow = await fox.open(`${base}/login.html?l=2`);
  await send({ type: "agent", id: "agent-2", tabId: await tabOf("login.html?l=2"), handoffTimeoutMs: 1500 });
  const agent2 = await agentDone("agent-2");
  const handResult = agent2.events.find((e) => e.type === "tool-result" && e.name === "hand_to_user");
  check("L2 a handoff that times out is a failed result", { ok: false, timeout: true }, { ok: handResult?.ok, timeout: handResult?.summary.includes("did not finish") });
  await send({ type: "agent", id: "agent-3", tabId: await tabOf("login.html?l=2") });
  await waitingFor("agent-3");
  await send({ type: "agent-cancel", id: "agent-3" });
  const agent3 = await agentDone("agent-3");
  check("L6 a stopped run stops the handoff", ["aborted", "cancelled"], [agent3.status, (await eventsOf("agent-3")).find((e) => e.type === "ended")?.status]);
  await slow.close();

  // L3, L4, L5: the tool on its own.
  const quiet = await fox.open(`${base}/plain.html?l=3`);
  const quietTab = await tabOf("plain.html?l=3");
  check("L3 no wall: the tool passes at once", { ok: true, summary: "No sign-in step on this page." }, await send({ type: "tool", tabId: quietTab }));
  await quiet.close();
  check("L4 a tab that is gone: domain throws", "throws", await send({ type: "tool-domain", tabId: quietTab }));
  check("L5 the model can pass only a short reason", { type: "object", properties: { reason: { type: "string", maxLength: 200 } }, additionalProperties: false }, await send({ type: "tool-schema" }));
} catch (error) {
  record.error = error instanceof Error ? error.message : String(error);
} finally {
  await fox?.close();
  await site.close();
}
record.passed = !record.error && record.checks.length > 0 && record.checks.every((c) => c.ok);
const path = writeArtifact("artifacts", "e2e", record);
for (const c of record.checks) console.log(`${c.ok ? "ok " : "BAD"} ${c.name}${c.ok ? "" : `: wanted ${JSON.stringify(c.expected)}, got ${JSON.stringify(c.actual)}`}`);
console.log(`${record.passed ? "PASS" : "FAIL"} ${record.checks.filter((c) => c.ok).length}/${record.checks.length}${record.error ? `: ${record.error}` : ""} | ${path}`);
process.exitCode = record.passed ? 0 : 1;
