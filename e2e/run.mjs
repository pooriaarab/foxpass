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
