# What the foxpass add-on sends, and its AMO data declaration

The manifest declares `data_collection_permissions: { "required": ["none"] }`.
This page lists everything that the add-on in `extension/` sends out of the
browser, and why no AMO data type applies to it.

## The rule we apply

AMO's add-on policies, section 6, define data transmission:

> For the purposes of this policy, data transmission refers to any data that
> is collected, used, transferred, shared, or handled outside of the add-on or
> the local browser.

The page "Firefox built-in consent for data collection and transmission"
(https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/)
gives the data types that the manifest key declares, and says:

> If your extension doesn't collect or transmit any data, you indicate that by
> specifying the `none` required permission in the manifest.

So the question for each item below is: does it leave the browser, and is it
one of the data types in that taxonomy?

## What the add-on handles

| What | Where it goes | AMO data type |
|---|---|---|
| The scan of a page: field types, names, labels, button text, headings, frame addresses, and passkey call states. No field values. | The background page of the add-on. It stays in memory. | None. It does not leave the browser. |
| What the demo agent reads: page text and fields, with password, code, and card values as `[redacted]` | The demo agent's rule planner, in the background page. | None. The planner is fixed rules in the add-on. It sends nothing to a model or a server. |
| The banner text and the field outline | The page in the tab. | None. The add-on writes this text. |
| The record of passkey calls (kind, RP ID, end state, time) | A `data-foxpass-webauthn` attribute on the page's own document. | None. It holds no credential and goes to no server. |
| The sign-in cookie value that `cookies.get` reads | Compared in memory with the value at the start of the handoff. | None. It is not stored or sent. |

The add-on makes no network request of its own. It has no analytics, no
error reports, and no server. Nothing goes to the authors.

## Decision

No data leaves the browser, so `"none"` is the true declaration.

## When this changes

An app that gives `readTab` output to a model on a server (for example an own
key in foxmate) sends website content. That app must declare
`websiteContent` and ask Firefox's consent before the first send. The demo
add-on does not do this.
