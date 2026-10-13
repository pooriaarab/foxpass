// Tests for docs/failure-modes.md C1-C19. Written before src/classify.ts.
import { describe, expect, it } from "vitest";
import { classify, FoxpassError, type FieldInfo, type PageScan } from "../src/index.js";

const field = (over: Partial<FieldInfo>): FieldInfo => ({
  selector: "#f",
  tag: "input",
  type: "text",
  autocomplete: "",
  name: "",
  id: "",
  label: "",
  placeholder: "",
  inputMode: "",
  maxLength: -1,
  visible: true,
  filled: false,
  form: 0,
  ...over,
});
const scan = (over: Partial<PageScan>): PageScan => ({
  url: "https://shop.example.com/login",
  title: "Shop",
  headings: [],
  fields: [],
  buttons: [],
  frames: [],
  captchaMarks: [],
  webauthn: [],
  ...over,
});
const kinds = (s: PageScan) => classify(s).map((w) => w.kind);

describe("password walls", () => {
  it("C1 ignores a hidden password field", () => {
    expect(classify(scan({ fields: [field({ type: "password", visible: false })] }))).toEqual([]);
  });
  it("C2 finds a visible password field with its selector and reason", () => {
    const [wall] = classify(scan({ fields: [field({ selector: "#pw", type: "password", autocomplete: "current-password" })] }));
    expect(wall).toMatchObject({ kind: "password", selector: "#pw", host: "shop.example.com" });
    expect(wall?.reason).toContain("a visible password field");
  });
  it("C3 calls a new-password field a sign-up in the reason", () => {
    const [wall] = classify(scan({ fields: [field({ type: "password", autocomplete: "new-password" })] }));
    expect(wall?.kind).toBe("password");
    expect(wall?.reason).toContain("new-password");
  });
});

describe("OTP walls", () => {
  it("C4 finds autocomplete=one-time-code", () => {
    const [wall] = classify(scan({ fields: [field({ selector: "#otp", autocomplete: "one-time-code" })] }));
    expect(wall).toMatchObject({ kind: "otp", selector: "#otp" });
    expect(wall?.reason).toContain("autocomplete=one-time-code");
  });
  it("C5 finds a short field labelled as a code", () => {
    expect(kinds(scan({ fields: [field({ label: "Verification code", maxLength: 6 })] }))).toEqual(["otp"]);
    expect(kinds(scan({ fields: [field({ name: "totp", inputMode: "numeric" })] }))).toEqual(["otp"]);
    expect(kinds(scan({ fields: [field({ placeholder: "Enter the 2FA code", maxLength: 8 })] }))).toEqual(["otp"]);
  });
  it("C5 ignores a long code field that is not numeric", () => {
    expect(kinds(scan({ fields: [field({ label: "Security code", maxLength: 200 })] }))).toEqual([]);
  });
  it("C6 finds split one-digit boxes and points at the first one", () => {
    const boxes = [1, 2, 3, 4, 5, 6].map((n) => field({ selector: `#d${n}`, maxLength: 1, inputMode: "numeric" }));
    const walls = classify(scan({ fields: boxes }));
    expect(walls).toHaveLength(1);
    expect(walls[0]).toMatchObject({ kind: "otp", selector: "#d1" });
  });
  it("C6 ignores three one-character boxes", () => {
    const boxes = [1, 2, 3].map((n) => field({ selector: `#d${n}`, maxLength: 1 }));
    expect(classify(scan({ fields: boxes }))).toEqual([]);
  });
  it("C19 reads an unmarked Security code field in a card form as part of the card, not an OTP", () => {
    const card = field({ selector: "#num", label: "Card number", inputMode: "numeric", maxLength: 19 });
    for (const code of [{ label: "Security code" }, { name: "cvc", label: "CVC code" }, { id: "cvv", placeholder: "Card code" }]) {
      expect(kinds(scan({ fields: [card, field({ selector: "#csc", maxLength: 4, inputMode: "numeric", ...code })] }))).toEqual([]);
    }
    const marked = field({ selector: "#num", autocomplete: "cc-number", label: "Number" });
    expect(kinds(scan({ fields: [marked, field({ selector: "#csc", label: "Security code", maxLength: 3 })] }))).toEqual([]);
  });
  it("C19 still finds an OTP next to a card field when the field says so, and a security code with no card field", () => {
    const card = field({ selector: "#num", label: "Card number", maxLength: 19 });
    expect(kinds(scan({ fields: [card, field({ selector: "#otp", label: "Security code", autocomplete: "one-time-code" })] }))).toEqual(["otp"]);
    expect(kinds(scan({ fields: [card, field({ selector: "#otp", label: "SMS verification code", maxLength: 6, inputMode: "numeric" })] }))).toEqual(["otp"]);
    expect(kinds(scan({ fields: [field({ selector: "#otp", label: "Security code", maxLength: 6, inputMode: "numeric" })] }))).toEqual(["otp"]);
    expect(kinds(scan({ fields: [{ ...card, form: 1 }, field({ selector: "#otp", label: "Security code", maxLength: 6 })] }))).toEqual(["otp"]);
    // A field in no form (form -1) is not in a card form: fields outside any form share no group (fails closed).
    expect(kinds(scan({ fields: [{ ...card, form: -1 }, field({ selector: "#otp", label: "Security code", maxLength: 6, form: -1 })] }))).toEqual(["otp"]);
  });
  it("C7 ignores coupon, promo, gift, and postal code fields", () => {
    for (const name of ["coupon_code", "promo-code", "giftcode", "postal_code", "zip code", "discount code"]) {
      expect(kinds(scan({ fields: [field({ name, maxLength: 8 })] }))).toEqual([]);
    }
  });
});

describe("sign-in walls", () => {
  it("C8 finds an identifier-first sign-in form", () => {
    const s = scan({ fields: [field({ selector: "#email", type: "email", autocomplete: "username" })], buttons: [{ text: "Next", form: 0, visible: true }] });
    const [wall] = classify(s);
    expect(wall).toMatchObject({ kind: "sign-in", selector: "#email" });
  });
  it("C8 finds a sign-in form named by its heading", () => {
    const s = scan({ headings: ["Sign in to Shop"], fields: [field({ name: "username" })], buttons: [{ text: "Continue", form: 0, visible: true }] });
    expect(kinds(s)).toEqual(["sign-in"]);
  });
  it("C9 ignores a newsletter form", () => {
    const s = scan({ headings: ["Our newsletter"], fields: [field({ type: "email", name: "email" })], buttons: [{ text: "Subscribe", form: 0, visible: true }] });
    expect(classify(s)).toEqual([]);
  });
  it("C17 gives no sign-in wall for a form with a password wall", () => {
    const s = scan({
      fields: [field({ selector: "#email", type: "email" }), field({ selector: "#pw", type: "password" })],
      buttons: [{ text: "Sign in", form: 0, visible: true }],
    });
    expect(kinds(s)).toEqual(["password"]);
  });
});

describe("WebAuthn walls", () => {
  it("C10 finds a pending get and a pending create with the RP ID", () => {
    const get = classify(scan({ webauthn: [{ kind: "get", rpId: "example.com", state: "pending", conditional: false, at: 1 }] }));
    expect(get[0]).toMatchObject({ kind: "webauthn" });
    expect(get[0]?.reason).toContain("example.com");
    const create = classify(scan({ webauthn: [{ kind: "create", rpId: "example.com", state: "pending", conditional: false, at: 1 }] }));
    expect(create[0]?.reason).toContain("create");
  });
  it("C10 ignores a finished call", () => {
    for (const state of ["fulfilled", "rejected"] as const) {
      expect(classify(scan({ webauthn: [{ kind: "get", rpId: "example.com", state, conditional: false, at: 1 }] }))).toEqual([]);
    }
  });
  it("C11 ignores a pending conditional request alone", () => {
    expect(classify(scan({ webauthn: [{ kind: "get", rpId: "example.com", state: "pending", conditional: true, at: 1 }] }))).toEqual([]);
  });
});

describe("CAPTCHA walls", () => {
  it("C12 finds each provider frame and names it", () => {
    const frames: [string, string][] = [
      ["https://www.google.com/recaptcha/api2/anchor?k=x", "reCAPTCHA"],
      ["https://newassets.hcaptcha.com/captcha/v1/x", "hCaptcha"],
      ["https://challenges.cloudflare.com/cdn-cgi/challenge-platform/x", "Turnstile"],
      ["https://client-api.arkoselabs.com/fc/x", "Arkose"],
    ];
    for (const [src, name] of frames) {
      const [wall] = classify(scan({ frames: [src] }));
      expect(wall?.kind).toBe("captcha");
      expect(wall?.reason).toContain(name);
    }
  });
  it("C12 finds a widget mark", () => {
    expect(kinds(scan({ captchaMarks: ["g-recaptcha"] }))).toEqual(["captcha"]);
    expect(kinds(scan({ captchaMarks: ["cf-turnstile"] }))).toEqual(["captcha"]);
  });
  it("C13 counts CAPTCHA text only in a heading", () => {
    expect(kinds(scan({ headings: ["Verify you are human"] }))).toEqual(["captcha"]);
    expect(classify(scan({ title: "Why I'm not a robot: a blog post" }))).toEqual([]);
  });
});

describe("OAuth consent walls", () => {
  it("C14 finds an authorize URL with client_id", () => {
    const [wall] = classify(scan({ url: "https://accounts.example.com/o/oauth2/v2/auth?client_id=abc&scope=email&response_type=code" }));
    expect(wall).toMatchObject({ kind: "oauth-consent", host: "accounts.example.com" });
    expect(wall?.reason).toContain("client_id");
    expect(kinds(scan({ url: "https://id.example.com/consent?client_id=1" }))).toEqual(["oauth-consent"]);
    expect(kinds(scan({ url: "https://id.example.com/authorize?client_id=1" }))).toEqual(["oauth-consent"]);
  });
  it("C15 ignores a page about OAuth with no client_id", () => {
    expect(classify(scan({ url: "https://blog.example.com/oauth-explained", headings: ["OAuth explained"] }))).toEqual([]);
  });
});

describe("input and order", () => {
  it("C16 throws bad-scan for a malformed scan", () => {
    const bad: unknown[] = [null, {}, { ...scan({}), fields: "x" }, { ...scan({}), url: "not a url" }, { ...scan({}), fields: [{ selector: 1 }] }];
    for (const input of bad) {
      expect(() => classify(input as PageScan)).toThrow(FoxpassError);
      try {
        classify(input as PageScan);
      } catch (error) {
        expect((error as FoxpassError).code).toBe("bad-scan");
      }
    }
  });
  it("C18 orders the walls by step", () => {
    const s = scan({
      url: "https://id.example.com/authorize?client_id=1",
      fields: [field({ selector: "#pw", type: "password", form: 0 }), field({ selector: "#otp", autocomplete: "one-time-code", form: 1 }), field({ selector: "#u", name: "username", form: 2 })],
      buttons: [{ text: "Log in", form: 2, visible: true }],
      frames: ["https://www.google.com/recaptcha/api2/anchor"],
      webauthn: [{ kind: "get", rpId: "example.com", state: "pending", conditional: false, at: 1 }],
    });
    expect(kinds(s)).toEqual(["webauthn", "captcha", "oauth-consent", "otp", "password", "sign-in"]);
  });
});
