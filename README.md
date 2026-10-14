# foxpass

[![npm version](https://img.shields.io/npm/v/foxpass)](https://www.npmjs.com/package/foxpass)
[![Downloads/month](https://img.shields.io/npm/dm/foxpass)](https://www.npmjs.com/package/foxpass)
[![MIT license](https://img.shields.io/npm/l/foxpass)](https://opensource.org/license/mit)
![Zero runtime dependencies](https://img.shields.io/badge/runtime_dependencies-0-blue)
![Types included](https://img.shields.io/badge/types-included-blue)

[Setup](#install) · [API reference](#runtime-surfaces) · [Comparisons](#compare) · [Source](https://github.com/pooriaarab/foxpass)

foxpass is an open-source authentication handoff library for Firefox browser agents.
It detects sign-in steps, asks the user to complete them, and checks when the agent can resume.
Its page readers redact recognized secret fields before returning snapshots.

## Install

```bash
npm install foxpass
```

Node.js 24 or later is required for the examples and development tools.
The package includes TypeScript declarations and has zero runtime dependencies.
Browser operations run inside your Firefox extension with the required permissions.

## Redact your first snapshot

Save the following example as `quickstart.mjs`, then run `node quickstart.mjs`.
No credentials, environment variables, or `.env` file are required.

This part runs in Node 24 or later as written. It needs no browser.

```js
import { classify, redactSnapshot } from "foxpass";

// A page scan, as scanTab reads it from a tab. It holds no field values.
const field = { tag: "input", autocomplete: "", name: "", id: "", label: "", placeholder: "", inputMode: "", maxLength: -1, visible: true, filled: false, form: 0 };
const scan = {
  url: "https://bank.example/login",
  title: "Sign in",
  headings: ["Sign in"],
  fields: [{ ...field, selector: "#email", type: "email", name: "email" }, { ...field, selector: "#pw", type: "password", autocomplete: "current-password" }],
  buttons: [{ text: "Sign in", form: 0, visible: true }],
  frames: [],
  captchaMarks: [],
  webauthn: [],
};
console.log(classify(scan));
// [ { kind: 'password', reason: 'a visible password field', selector: '#pw', host: 'bank.example' } ]

// A snapshot from any reader, for example foxpaw. Secret values go.
const snapshot = { text: "Code 424242 sent", controls: [{ autocomplete: "one-time-code", value: "424242" }, { type: "search", value: "loans" }] };
console.log(redactSnapshot(snapshot));
// { text: 'Code [redacted] sent', controls: [ { autocomplete: 'one-time-code', value: '[redacted]' }, { type: 'search', value: 'loans' } ] }
```

In a Firefox extension, the background page scans a tab and hands the wall to
the user. The extension needs the permissions `scripting` and `webNavigation`,
and host access to the site.

```js
import { createHandoff, registerWebAuthnObserver, scanTab } from "foxpass";

// observer.js is a file you bundle that runs: import { observeWebAuthn } from "foxpass"; observeWebAuthn();
await registerWebAuthnObserver(browser, { js: "observer.js" });
const handoff = createHandoff({ browser, onNeedsUser: (notice) => console.log(notice.message) });

const { walls } = await scanTab(browser, tabId);
if (walls.length) {
  const result = await handoff.toUser({ tabId, walls });
  // { status: "signed-in", signal: "url-changed", host: "bank.example" }, or a timeout, a closed tab...
}
```

With [foxloop](https://github.com/pooriaarab/foxloop), give the planner the two
tools. `hand_to_user` holds the run while the user signs in.

```js
import { createFoxgate } from "foxgate";
import { createLoop, toolSpecs } from "foxloop";
import { handoffTool, readPageTool } from "foxpass";

const tools = [readPageTool({ browser, tabId: () => tabId }), handoffTool({ handoff, browser, tabId: () => tabId })];
const { gate, host } = createFoxgate({ tools: toolSpecs(tools) });
await host.addGrant({ scope: "read", domains: ["bank.example"] });
for await (const event of createLoop({ mind, gate, tools }).run("Read my balance.")) console.log(event.type);
```

## How it works

```text
Firefox tab -> scanTab -> classify -> hand_to_user -> user signs in
                                ^                         |
                                +--- poll for completion -+
Firefox tab -> readTab -> redactSnapshot -> agent page reader
```

The classifier has six wall categories: passkey, CAPTCHA, OAuth consent, one-time code, password, and sign-in.
The observer records Web Authentication (WebAuthn) call state, without the credential result.
URL and form completion signals require two agreeing scans.
Cookie and custom checks can complete a handoff directly.

## Why it exists

A browser agent can reach a password, one-time password (OTP), or passkey step that needs a person.
foxpass provides that handoff inside a Firefox extension.
Playwright and Selenium provide browser automation APIs; your application still chooses its authentication workflow.

## Compare

Scope checked on 2026-10-14 against the linked official documentation.

| Scope | foxpass | [Playwright](https://playwright.dev/docs/auth) | [Selenium](https://www.selenium.dev/documentation/webdriver/) |
|---|---|---|---|
| Main role | Authentication handoff and redaction | Browser testing and automation | WebDriver browser automation |
| Execution | Your Firefox extension | Your browser automation process | Your WebDriver session |
| Configuration | JavaScript library calls | Test fixtures and browser contexts | Driver and language bindings |
| Authentication path | User handoff and completion checks | Reusable authentication state | Application-defined browser steps |

## Coverage

| Surface or integration | Status | Behavior |
|---|---|---|
| Firefox WebExtensions | Implemented | Scan, snapshot, banner, tab focus, and polling |
| WebAuthn passkeys | Detection only | Observe pending nonconditional requests; user completes the ceremony |
| Password, OTP, sign-in fields | Heuristic detection | Classify visible fields and form hints |
| OAuth consent | Heuristic detection | Authorization path and `client_id` query |
| Google reCAPTCHA | Detection only | Frame URL or widget class |
| hCaptcha | Detection only | Frame URL or widget class |
| Cloudflare Turnstile | Detection only | Frame URL or widget class |
| Arkose Labs / FunCaptcha | Detection only | Frame URL |
| foxloop | Implemented | `read_page` and `hand_to_user` tool shapes |
| foxvault | Implemented | Delegate approved filling through `fillWall` |
| foxpaw snapshots | Implemented | Redact `controls` as well as `fields` |

Source inventory: six wall categories, four named CAPTCHA patterns, and two agent tools.
These are code-backed paths, with local tests for detection and handoff behavior.
No provider credential checks or live CAPTCHA-provider verification were performed for this rewrite.
There are no scaffolded provider adapters in this inventory.

## Common use cases

1. Firefox agent authors: pause a foxloop run when a site requires a password or passkey.
2. QA engineers: hand an OTP step to a person during a Firefox staging-site test.
3. Agent tool authors: redact foxpaw snapshots before passing page content to a planner.
4. Password-manager authors: route a foxvault fill request through a detected field and its document identifier.
5. Notification authors: connect `onNeedsUser` to their own notification handler.

## Features

- **Wall classification:** six categories with reasons and optional field selectors.
- **User handoff:** banner, field outline, tab focus, timeout, and cancellation.
- **Completion checks:** URL change, form removal, cookie change, or a custom check.
- **Snapshot redaction:** password, OTP, card-number, and card-code field handling.
- **Agent tools:** `read_page` and `hand_to_user`, both with read scope.
- **Optional fill:** `fillWall` delegates to a supplied foxvault-compatible vault.

## Runtime surfaces

foxpass exports a JavaScript library with TypeScript types.
Pure classification and redaction run in Node.js; tab operations require Firefox WebExtension APIs.
It has no command-line interface or Model Context Protocol (MCP) server.
Its two agent tools are `read_page` and `hand_to_user`.

### API

foxpass is a library. It has no CLI and no MCP server: every part needs a
live tab in Firefox, and the user at that tab.

#### Classify and read

| Export | What it does |
|---|---|
| `classify(scan)` | Returns `Wall[]`: `{ kind, reason, selector?, host }`, in the order `webauthn`, `captcha`, `oauth-consent`, `otp`, `password`, `sign-in`. Throws `FoxpassError` `bad-scan` for a scan of the wrong shape. |
| `scanTab(browser, tabId)` | Returns `{ scan, walls, documentId? }` for the top document. |
| `readTab(browser, tabId)` | Returns a `PageSnapshot` for the agent: the URL, the title, up to 4000 characters of text, and the fields, with secret values `[redacted]`. |
| `redactSnapshot(snapshot)` | Returns a copy with each password, OTP, `cc-number`, `cc-csc`, or `secret: true` value as `[redacted]`. It replaces values of 4 or more characters in every other string too. Fields come from `controls` (foxpaw) and `fields`. |
| `isSecretField(field)`, `REDACTED` | The rule that `redactSnapshot` uses, and the text `[redacted]`. |
| `scanPage()`, `observeWebAuthn()` | The page functions. Bundle `observeWebAuthn` into the file that `registerWebAuthnObserver` names. |
| `registerWebAuthnObserver(browser, { js, matches? })` | Registers `js` as a `MAIN` world content script at `document_start`. Default matches: `http://*/*` and `https://*/*`. |

#### Hand off

`createHandoff(options)` returns `{ toUser(request), waiting() }`.

| Option | Default | What it does |
|---|---|---|
| `browser` | required | `tabs`, `windows`, `scripting`, `webNavigation`, and `cookies` for the cookie signal. In Firefox, pass `browser`. |
| `timeoutMs` | 5 minutes | How long the user has. 1 s to 30 min, else `bad-option`. |
| `pollMs` | 500 | How often foxpass checks the tab. 100 ms to 10 s. |
| `onNeedsUser` | none | `(notice) => void`. `notice` has `tabId`, `host`, `kind`, `message`, and `walls`. If it throws, the handoff goes on. |
| `onEvent` | none | Gets `paused`, `wall-changed`, `resumed`, `ended`, and `notify-failed`, `highlight-failed`, `check-failed`, `scan-failed`. Events hold no values. |

`toUser({ tabId, walls?, hosts?, cookie?, check?, signal?, timeoutMs? })`
returns one of:

- `{ status: "signed-in", signal, host }`. `signal` is `url-changed` (the tab
  left the wall page on the same host, or on a host in `hosts`, and the new
  page has no wall), `form-gone`, `cookie` (the cookie `{ url, name }`
  appeared or changed), or `check` (your function returned true).
- `{ status: "timeout" | "tab-closed" | "cancelled" | "busy" | "no-wall" }`.

`messageFor(wall)` gives the words that the banner shows.

### Agent tools

Both tools have the foxloop tool shape and scope `read`. foxpass does not
import foxloop.

| Export | What it does |
|---|---|
| `handoffTool({ handoff, browser, tabId, request? })` | `hand_to_user`. The model can pass only `reason` (200 characters at most). `signed-in` and `no-wall` are `ok: true`. The other statuses are failed results with a summary that says to stop. |
| `readPageTool({ browser, tabId, check? })` | `read_page`. The summary says if the page has a wall. The page goes in `untrusted`. `check(snapshot)` can return a foxloop check. |

### Fill from foxvault (optional)

`fillWall({ vault, handle, tabId, scan, wall, token? })` fills a
[foxvault](https://github.com/pooriaarab/foxvault) secret into a `password`,
`otp`, or `sign-in` field from `scan`. It returns `refused` `not-a-wall-field`
or `wrong-kind` for other fields. Then it calls `vault.fill` with the scanned
`documentId`: foxvault checks the secret's hosts, asks foxgate (the approval
shows the host and the selector), and refuses `page-changed` for a page that
changed after the scan.

### Demo extension

`extension/` is a demo for Firefox 153 and later. A small agent with fixed
rules (no AI model) reads a balance on a sample bank site in `demo/site/`.

```bash
pnpm install
pnpm site        # serves demo/site/ on http://localhost:8790
pnpm build:ext   # builds dist-ext/; load it from about:debugging
```

Open `http://localhost:8790/login.html`, open the foxpass popup, click
**Allow foxpass on this site**, reload the page, and click **Run the agent
here**. Sign in with `ada@example.com` and the password `correct horse`, then
type the code `424242`. The popup shows the balance.

#### Tests

```bash
pnpm ci:local    # lint, typecheck, unit tests, build, web-ext lint, AMO listing check
pnpm e2e         # two Firefox E2E tests; they write artifacts/e2e-<date>.json and artifacts/e2e-passkey-<date>.json
```

`e2e/run.mjs` uses Puppeteer over WebDriver BiDi. The test acts as the user:
it types the password and the code after foxpass hands the step over.
`e2e/passkey.mjs` uses Marionette, because WebDriver BiDi has no WebAuthn
commands. Firefox first waits for a USB key, so the passkey request stays
pending. The test then adds a virtual authenticator and a passkey, and clicks
"Use a passkey".

## Delivery and behavior limits

- foxpass cannot read the passwords that Firefox saves, and it cannot finish
  a passkey ceremony. The user does both.
- The detection rules are heuristics. A site that names its fields in an odd
  way, draws its form in a canvas, or puts it in an iframe can hide a wall.
  The scan reads the top document only.
- A page can see the observer: the wrapped functions and the
  `data-foxpass-webauthn` attribute are visible to page scripts. A page can
  remove the record, and then foxpass misses its passkey call. A page can
  fake a record, and then foxpass starts a handoff with no real request.
- A conditional (autofill) passkey request alone is not a wall.
- The handoff waits in the memory of the background page. When Firefox
  unloads the event page, the wait stops. Keep the wait short, or keep the
  task state with your own store.
- A sign-in that ends on a page that has a sign-in form (for example a
  "sign in to another account" page) does not count as signed in. Use
  `cookie` or `check` for such a site.
- `redactSnapshot` replaces values exactly. It does not find a value that a
  page changed in case, cut, or encoded.
- The demo agent has fixed rules. It is not a model, and it knows only the
  sample bank site. The demo keeps its foxvault secret and its approvals in
  memory.
- The passkey E2E test needs a Firefox that waits for a USB key when no key
  is there. If Firefox fails the request at once, the test cannot see a
  pending call.

## Integration guides

- [Firefox extension handoff setup](#redact-your-first-snapshot) includes permissions and observer registration.
- [foxloop agent tools](#agent-tools) describes the two read-scope tools.
- [foxvault optional fill](#fill-from-foxvault-optional) explains vault delegation.
- [Firefox demo extension](#demo-extension) gives a local sign-in walkthrough.

## Status

Version 0.1.3 is an early release. Public APIs can change during the 0.x series.
Report problems through [GitHub issues](https://github.com/pooriaarab/foxpass/issues).
Public case studies are not yet published in this repository.

## FAQ

### What is foxpass?

foxpass is a Firefox authentication handoff library for browser agents.
It detects sign-in steps and waits while a person completes them.

### Which integrations are verified?

foxpass has source-backed Firefox, foxloop, foxvault, and foxpaw paths.
This rewrite runs local tests; it does not certify live provider behavior.

### Does foxpass provide a managed authentication service?

foxpass runs in your extension and application.
You supply the browser, planner, permissions, and task state.

### How is foxpass different from Playwright?

foxpass handles user handoff and snapshot redaction inside a Firefox extension.
[Playwright authentication](https://playwright.dev/docs/auth) documents reusable browser state for automated tests.

### How is foxpass different from Selenium?

foxpass supplies a sign-in handoff workflow and agent tool shapes.
[Selenium WebDriver](https://www.selenium.dev/documentation/webdriver/) supplies browser automation through drivers and language bindings.

### Can foxpass solve a CAPTCHA or complete a passkey?

foxpass detects known CAPTCHA hints and pending passkey requests.
The user completes those steps in the browser.

### Does foxpass hide every possible secret?

foxpass redacts recognized field values and exact copies of secrets with at least four characters.
Encoded, shortened, or differently cased copies can remain visible.

### Does foxpass resume when the page URL changes?

foxpass checks the new host and confirms that the page has no detected wall.
Two agreeing scans are required for URL and form signals.

### Can foxpass fill a password from foxvault?

foxpass delegates a detected password, OTP, or sign-in field to the vault through `fillWall`.
The vault handles host checks and approval; foxpass returns a status.

## License

MIT. See the [MIT license text](https://opensource.org/license/mit).
