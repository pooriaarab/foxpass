// Name each auth wall on a page scan, with a reason. Pure: no browser API.
// The rules follow docs/failure-modes.md C1-C19.
import { FoxpassError } from "./errors.js";
import type { FieldInfo, PageScan, Wall, WallKind } from "./types.js";

const ORDER: WallKind[] = ["webauthn", "captcha", "oauth-consent", "otp", "password", "sign-in"];

/** Words that name a one-time code field, after `words()`. */
export const CODE_WORDS = /\b(otp|one time|2fa|two factor|mfa|totp|passcode|verification|verify|security code|auth code|authentication code|sms code|code)\b/;
/** Words that name a code field that is not a one-time code. */
export const NOT_OTP = /coupon|promo|gift|postal|post code|postcode|zip|discount|voucher|referral|country|area code|invite/;
/** Words that name a card code (C19). In a card form, such a field is part of the card, not a one-time code. */
const CARD_CODE = /\b(security code|cvc|cvv|cvv2|csc|card code|card verification)\b/;
/** Words that name a card number field (C19). */
const CARD_NUMBER = /\b(card number|card no|cc number|credit card|debit card)\b/;
const IDENTIFIER = /\b(user|username|login|email|e mail|identifier|account|phone)\b/;
const SIGN_IN_BUTTON = /\b(sign in|log in|login|next)\b/;
const SIGN_IN_HEADING = /\b(sign in|log in|login)\b/;
const CAPTCHA_HEADING = /verify you are (a )?human|i'?m not a robot|are you a robot|complete the captcha|security check/;
const CAPTCHA_FRAMES: [RegExp, string][] = [
  [/(google\.com|recaptcha\.net)\/recaptcha/, "reCAPTCHA"],
  [/hcaptcha\.com/, "hCaptcha"],
  [/challenges\.cloudflare\.com/, "Turnstile"],
  [/arkoselabs\.com|funcaptcha/, "Arkose"],
];
const CAPTCHA_MARKS: Record<string, string> = { "g-recaptcha": "reCAPTCHA", "h-captcha": "hCaptcha", "cf-turnstile": "Turnstile" };

/** Lower case, with `_ - .` and camelCase turned into spaces. */
export const words = (text: string) =>
  text
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[_\-.]+/g, " ");
/** The parts of a field that name it. Other readers (for example foxpaw) give only some of them. */
export type FieldHints = Partial<Pick<FieldInfo, "type" | "autocomplete" | "name" | "id" | "label" | "placeholder" | "inputMode" | "maxLength">>;
const describe = (f: FieldHints) => words(`${f.name ?? ""} ${f.id ?? ""} ${f.label ?? ""} ${f.placeholder ?? ""}`);

const isString = (v: unknown) => typeof v === "string";
const isList = (v: unknown, item: (x: Record<string, unknown>) => boolean) =>
  Array.isArray(v) && v.every((x) => typeof x === "object" && x !== null && item(x as Record<string, unknown>));

function hostOf(scan: unknown): string {
  const s = scan as Partial<PageScan> | null;
  const ok =
    typeof s === "object" &&
    s !== null &&
    isString(s.url) &&
    isString(s.title) &&
    Array.isArray(s.headings) &&
    s.headings.every(isString) &&
    isList(s.fields, (f) => isString(f.selector) && isString(f.type) && isString(f.autocomplete) && isString(f.name) && isString(f.id) && isString(f.label) && isString(f.placeholder) && isString(f.inputMode) && typeof f.maxLength === "number" && typeof f.visible === "boolean" && typeof f.form === "number") &&
    isList(s.buttons, (b) => isString(b.text) && typeof b.form === "number" && typeof b.visible === "boolean") &&
    Array.isArray(s.frames) &&
    s.frames.every(isString) &&
    Array.isArray(s.captchaMarks) &&
    s.captchaMarks.every(isString) &&
    isList(s.webauthn, (c) => (c.kind === "get" || c.kind === "create") && isString(c.rpId) && isString(c.state) && typeof c.conditional === "boolean");
  if (!ok) throw new FoxpassError("bad-scan", "The page scan does not have the expected shape.");
  try {
    return new URL(s.url as string).hostname.toLowerCase();
  } catch {
    throw new FoxpassError("bad-scan", "The page scan URL is not a URL.");
  }
}

function captchaReason(scan: PageScan): string | undefined {
  for (const src of scan.frames) {
    for (const [pattern, name] of CAPTCHA_FRAMES) if (pattern.test(src.toLowerCase())) return `a ${name} frame`;
  }
  for (const mark of scan.captchaMarks) return `a ${CAPTCHA_MARKS[mark] ?? "CAPTCHA"} widget (${mark})`;
  const heading = scan.headings.find((h) => CAPTCHA_HEADING.test(h.toLowerCase()));
  return heading === undefined ? undefined : `a CAPTCHA heading: "${heading.slice(0, 80)}"`;
}

function oauthReason(url: URL): string | undefined {
  if (!/authorize|oauth|consent/i.test(url.pathname) || !url.searchParams.has("client_id")) return undefined;
  const scope = url.searchParams.get("scope");
  return `an OAuth consent URL (the path names authorization, the query has client_id${scope ? `, scope: ${scope.slice(0, 80)}` : ""})`;
}

/** Why a field is a one-time code field, or undefined when it is not one. */
export function otpReason(f: FieldHints): string | undefined {
  const autocomplete = (f.autocomplete ?? "").toLowerCase();
  if (autocomplete.split(/\s+/).includes("one-time-code")) return "autocomplete=one-time-code";
  if (autocomplete.startsWith("cc-")) return undefined;
  const text = describe(f);
  if (NOT_OTP.test(text) || !CODE_WORDS.test(text)) return undefined;
  const max = f.maxLength ?? -1;
  const short = (max > 0 && max <= 10) || f.inputMode === "numeric" || f.type === "tel" || f.type === "number";
  return short ? `a short field named as a code ("${text.trim().slice(0, 60)}")` : undefined;
}

const isIdentifier = (f: FieldInfo) =>
  f.type === "email" || /\b(username|email)\b/.test(f.autocomplete.toLowerCase()) || ((f.type === "text" || f.type === "tel") && IDENTIFIER.test(describe(f)));

/**
 * Name each auth wall on the page, with a reason, in the order the user meets
 * them. Throws `FoxpassError` `bad-scan` for a scan of the wrong shape.
 */
export function classify(scan: PageScan): Wall[] {
  const host = hostOf(scan);
  const walls: Wall[] = [];
  const add = (kind: WallKind, reason: string, selector?: string) => walls.push(selector === undefined ? { kind, reason, host } : { kind, reason, selector, host });

  const seen = new Set<string>();
  for (const call of scan.webauthn) {
    const key = `${call.kind} ${call.rpId}`;
    if (call.state !== "pending" || call.conditional || seen.has(key)) continue;
    seen.add(key);
    add("webauthn", `a pending passkey request (navigator.credentials.${call.kind}, RP ID ${call.rpId})`);
  }
  const captcha = captchaReason(scan);
  if (captcha !== undefined) add("captcha", captcha);
  const oauth = oauthReason(new URL(scan.url));
  if (oauth !== undefined) add("oauth-consent", oauth);

  const visible = scan.fields.filter((f) => f.visible);
  const used = new Set<FieldInfo>();
  const walled = new Set<number>();
  const byForm = new Map<number, FieldInfo[]>();
  for (const f of visible) byForm.set(f.form, [...(byForm.get(f.form) ?? []), f]);
  for (const [form, fields] of byForm) {
    const boxes = fields.filter((f) => f.maxLength === 1 && f.type !== "password");
    if (boxes.length < 4 || boxes.length > 8) continue;
    add("otp", `${boxes.length} one-character boxes in one form`, boxes[0]?.selector);
    for (const b of boxes) used.add(b);
    walled.add(form);
  }
  // C19: a form with a card number field; its card code field is not a one-time code.
  const cardForms = new Set(visible.filter((f) => f.autocomplete.toLowerCase().split(/\s+/).includes("cc-number") || CARD_NUMBER.test(describe(f))).map((f) => f.form));
  const cardCode = (f: FieldInfo) => cardForms.has(f.form) && CARD_CODE.test(describe(f)) && !f.autocomplete.toLowerCase().split(/\s+/).includes("one-time-code");
  for (const f of visible) {
    if (used.has(f) || cardCode(f)) continue;
    const reason = otpReason(f);
    if (reason === undefined) continue;
    add("otp", reason, f.selector);
    used.add(f);
    walled.add(f.form);
  }
  for (const f of visible) {
    if (f.type !== "password") continue;
    const signUp = f.autocomplete.toLowerCase().includes("new-password");
    add("password", signUp ? "a visible password field (autocomplete=new-password: a sign-up or a password change)" : "a visible password field", f.selector);
    walled.add(f.form);
  }
  const headings = scan.headings.some((h) => SIGN_IN_HEADING.test(words(h)));
  for (const [form, fields] of byForm) {
    if (walled.has(form)) continue;
    const id = fields.find((f) => !used.has(f) && isIdentifier(f));
    if (id === undefined) continue;
    const button = scan.buttons.find((b) => b.visible && b.form === form && SIGN_IN_BUTTON.test(words(b.text)));
    if (button === undefined && !headings) continue;
    add("sign-in", button === undefined ? "a sign-in heading over an email or username field" : `an email or username field with the button "${button.text.slice(0, 40)}"`, id.selector);
  }
  return walls.toSorted((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
}
