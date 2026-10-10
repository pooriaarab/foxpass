# Failure modes

This file lists every way foxpass can fail, before the code exists. Each row
has a test. A row with a `tests/` file has a vitest test. A row with `e2e`
has a check in the Firefox E2E test (`pnpm e2e`). Tests come before the code
in the git history.

## Classify (`classify`)

`classify` reads a page scan and names each auth wall with a reason.

| # | Failure mode | Wanted behaviour | Test |
|---|---|---|---|
| C1 | A hidden password field (a honeypot, or a field in a closed menu) counts as a wall. | Only visible fields count. A hidden password field gives no wall. | tests/classify.test.ts |
| C2 | A visible password field is missed. | A `password` wall with the field selector and the reason `a visible password field`. | tests/classify.test.ts |
| C3 | A sign-up form (`new-password`) is missed or called a login. | A `password` wall whose reason says `new-password`. | tests/classify.test.ts |
| C4 | An OTP field with `autocomplete="one-time-code"` is missed. | An `otp` wall with the reason `autocomplete=one-time-code`. | tests/classify.test.ts |
| C5 | An OTP field with only a name or label (for example "Verification code") is missed. | An `otp` wall when the name, id, label, or placeholder names a code and the field is short (at most 10 characters) or numeric. | tests/classify.test.ts |
| C6 | Split OTP boxes (one digit in each box) are missed. | An `otp` wall when 4 to 8 visible one-character fields sit in one form. The selector is the first box. | tests/classify.test.ts |
| C7 | A coupon, promo, gift, or postal code field counts as an OTP. | No `otp` wall for those names. | tests/classify.test.ts |
| C8 | An identifier-first sign-in (email, then a "Next" button, no password yet) is missed. | A `sign-in` wall when a form has an email or username field and a button or heading that says sign in, log in, or next. | tests/classify.test.ts |
| C9 | A newsletter form with an email field counts as a sign-in. | No wall when no button or heading says sign in, log in, or next. | tests/classify.test.ts |
| C10 | A WebAuthn call that waits for the user is missed, or a finished one still counts. | A `webauthn` wall for a pending `get` or `create`, with the RP ID. No wall when the call is fulfilled or rejected. | tests/classify.test.ts |
| C11 | A conditional (autofill) passkey request on every page makes every page a wall. | A pending conditional call alone gives no wall. | tests/classify.test.ts |
| C12 | A CAPTCHA is missed. | A `captcha` wall for a reCAPTCHA, hCaptcha, Turnstile, or Arkose frame or widget, with the provider in the reason. | tests/classify.test.ts |
| C13 | Body text that mentions a CAPTCHA counts as one. | Text counts only in a heading, for example "Verify you are human". | tests/classify.test.ts |
| C14 | An OAuth consent screen is missed. | An `oauth-consent` wall when the path has `authorize`, `oauth`, or `consent` and the query has `client_id`. | tests/classify.test.ts |
| C15 | A page that only mentions OAuth counts as consent. | No wall without `client_id` in the query. | tests/classify.test.ts |
| C16 | A malformed scan (missing lists, wrong types) gives a wrong answer. | `classify` throws `FoxpassError` `bad-scan`. | tests/classify.test.ts |
| C17 | The same field gives two walls (for example `password` and `sign-in`). | One wall for each field. A form with a password or OTP wall gives no `sign-in` wall. | tests/classify.test.ts |
| C18 | Walls come in a random order, so the agent tells the user the wrong step. | Order: `webauthn`, `captcha`, `oauth-consent`, `otp`, `password`, `sign-in`. | tests/classify.test.ts |

## Page scan and passkey observer (`scanPage`, `observeWebAuthn`)

| # | Failure mode | Wanted behaviour | Test |
|---|---|---|---|
| S1 | The scan reads a typed password or code. | The scan has no field values. It says only if a field is empty. | e2e |
| S2 | A field in a form gets no selector that finds it again. | Each field has a selector that `document.querySelector` finds. | e2e |
| S3 | The observer changes what the page gets from WebAuthn. | The observer calls the real function with the same arguments and returns its promise. It records the kind, the RP ID, and the end state, never the result. | e2e |
| S4 | The observer runs after the page calls WebAuthn, so it misses the call. | The observer is a `MAIN` world content script at `document_start`. | e2e |
| S5 | The observer starts a WebAuthn ceremony itself. | The observer never calls `get` or `create` on its own. | e2e |
| S6 | The page removes or fakes the observer record. | A fake record can only start a handoff. A removed record hides the call. The README says so. | README |

## Redact (`redactSnapshot`, `snapshotPage`)

| # | Failure mode | Wanted behaviour | Test |
|---|---|---|---|
| R1 | A password field value reaches the agent. | The value becomes `[redacted]`. | tests/redact.test.ts, e2e |
| R2 | An OTP field value reaches the agent. | The value becomes `[redacted]`. | tests/redact.test.ts, e2e |
| R3 | A field that another reader marks `secret: true` keeps its value. | The value becomes `[redacted]`. | tests/redact.test.ts |
| R4 | The secret value also shows in the page text or another string. | Each secret value of 4 or more characters is replaced in every string of the snapshot. | tests/redact.test.ts |
| R5 | An empty secret field shows `[redacted]`, so the agent thinks the user typed. | An empty value stays empty. | tests/redact.test.ts |
| R6 | A search box or other plain field loses its value. | Plain values do not change. | tests/redact.test.ts |
| R7 | `redactSnapshot` changes the object that the caller passed. | It returns a copy. | tests/redact.test.ts |
| R8 | A card number or card code keeps its value. | `cc-number` and `cc-csc` values become `[redacted]`. | tests/redact.test.ts |
| R9 | A hidden password field keeps its value. | Hidden secret fields are redacted too. | tests/redact.test.ts |

## Hand off to the user (`createHandoff`)

| # | Failure mode | Wanted behaviour | Test |
|---|---|---|---|
| H1 | The user closes the tab, and the agent waits for ever. | Status `tab-closed`. | e2e |
| H2 | The user never signs in, and the agent waits for ever. | Status `timeout` after `timeoutMs`. The banner is removed. | e2e |
| H3 | A sign-in is not seen when the page goes to the account page. | Status `signed-in`, signal `url-changed`, when the tab leaves the wall page on the same host and the new page has no wall. | e2e |
| H4 | The step after the password (an OTP page) counts as signed in. | When the new page has a wall, the handoff goes on, shows the new step, and emits `wall-changed`. | e2e |
| H5 | A single-page app hides the form without a new URL, and the sign-in is not seen. | Status `signed-in`, signal `form-gone`, when the walls are gone on the same URL. | e2e |
| H6 | A sign-in that only sets a cookie is not seen. | Status `signed-in`, signal `cookie`, when the named cookie appears or changes. | e2e |
| H7 | A custom check throws, and the handoff stops. | A throw counts as "not yet". The handoff emits `check-failed` and goes on. | e2e |
| H8 | The notify hook (for example foxnotify) throws, and the handoff stops. | The handoff emits `notify-failed` and goes on. | e2e |
| H9 | The tab cannot come to the front (its window is gone). | Status `tab-closed`. | e2e |
| H10 | One scan fails while the page loads, and the handoff stops. | A failed scan counts as "not yet". | e2e |
| H11 | The agent run stops, and the handoff waits on. | The abort signal ends the handoff with status `cancelled`. | e2e |
| H12 | The agent pauses on a page with no wall. | Status `no-wall` at once. | e2e |
| H13 | The banner cannot go into the page, and the handoff stops. | The handoff emits `highlight-failed` and goes on. | e2e |
| H14 | A handoff event or result holds a typed value. | Events hold kinds, reasons, selectors, and hosts only. The E2E test looks for the typed values in every event. | e2e |
| H15 | Two handoffs run on one tab and fight over the banner. | The second one gets status `busy`. | e2e |
| H16 | The user goes to another site, and that counts as signed in. | A new host counts only when it is in `hosts`. Else the handoff waits. | e2e |
| H17 | A bad `timeoutMs` or `pollMs` makes the handoff spin or never end. | `createHandoff` throws `bad-option` for `timeoutMs` outside 1 s to 30 min, or `pollMs` outside 100 ms to 10 s. | e2e |
| H18 | The tab closes while the first scan runs. The scan fails, and a failed scan reads as "no wall", so the handoff ends `no-wall` instead of `tab-closed`. CI found this on a slower runner. | A failed first scan is not "no wall". foxpass emits `scan-failed`, waits one poll, and ends `tab-closed` when the tab is gone or `tabs.onRemoved` fired for it. Else it scans again, 3 times at most. | tests/handoff.test.ts |

## Agent tool (`handoffTool`)

| # | Failure mode | Wanted behaviour | Test |
|---|---|---|---|
| L1 | The tool result gives the model a typed value. | The summary is text that foxpass writes. Page text never goes in it. | e2e |
| L2 | A handoff that ends without a sign-in counts as a pass. | `ok: false`, with the status in the summary. | e2e |
| L3 | The tool pauses on a page with no wall. | `ok: true` with the summary "No sign-in step on this page." | e2e |
| L4 | The tool acts on a tab that is gone. | `domain` throws, so foxloop refuses the call. | e2e |
| L5 | The model passes a selector or a URL to the tool. | The schema takes only an optional `reason` of at most 200 characters. | e2e |
| L6 | The run stops while the user signs in. | The tool passes the abort signal to the handoff. | e2e |

## Fill from foxvault (`fillWall`)

| # | Failure mode | Wanted behaviour | Test |
|---|---|---|---|
| V1 | The agent fills a field that is not part of an auth wall. | Status `refused`, reason `not-a-wall-field`. | e2e |
| V2 | The agent fills a CAPTCHA, a passkey, or a consent screen. | Status `refused`, reason `wrong-kind`. | e2e |
| V3 | Fill skips the foxgate approval or the host check. | foxpass calls `vault.fill`, which checks the secret's hosts and asks foxgate. The approval shows the host and the selector. | e2e |
| V4 | The page changes between the scan and the fill. | foxpass passes the scanned `documentId`, so foxvault refuses `page-changed`. | e2e |
