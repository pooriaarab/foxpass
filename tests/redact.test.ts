// Tests for docs/failure-modes.md R1-R9. Written before src/redact.ts.
import { describe, expect, it } from "vitest";
import { REDACTED, isSecretField, redactSnapshot } from "../src/index.js";

const control = (over: Record<string, unknown>) => ({ id: "0:1", role: "textbox", tag: "input", type: "text", label: "", name: "", placeholder: "", value: "", secret: false, ...over });

describe("redactSnapshot", () => {
  it("R1 redacts a password value", () => {
    const out = redactSnapshot({ controls: [control({ type: "password", value: "hunter22" })] });
    expect(out.controls[0]?.value).toBe(REDACTED);
  });
  it("R2 redacts OTP values found by autocomplete or by name", () => {
    const out = redactSnapshot({
      fields: [control({ autocomplete: "one-time-code", value: "424242" }), control({ name: "otp_code", maxLength: 6, value: "135790" }), control({ label: "Verification code", inputMode: "numeric", value: "777111" })],
    });
    expect(out.fields.map((f) => f.value)).toEqual([REDACTED, REDACTED, REDACTED]);
  });
  it("R3 redacts a field that another reader marks secret", () => {
    expect(redactSnapshot({ controls: [control({ secret: true, value: "•••" })] }).controls[0]?.value).toBe(REDACTED);
  });
  it("R4 replaces each secret value in every string of the snapshot", () => {
    const out = redactSnapshot({
      url: "https://x.example/?p=hunter22",
      text: "Your password hunter22 is weak. Code 424242.",
      headings: ["hunter22"],
      controls: [control({ type: "password", value: "hunter22" }), control({ autocomplete: "one-time-code", value: "424242" }), control({ label: "Note", value: "a hunter22 note" })],
    });
    expect(JSON.stringify(out)).not.toContain("hunter22");
    expect(JSON.stringify(out)).not.toContain("424242");
    expect(out.text).toBe(`Your password ${REDACTED} is weak. Code ${REDACTED}.`);
  });
  it("R4 leaves short secret values in other strings alone", () => {
    const out = redactSnapshot({ text: "Item 123 of 900", controls: [control({ type: "password", value: "123" })] });
    expect(out.text).toBe("Item 123 of 900");
    expect(out.controls[0]?.value).toBe(REDACTED);
  });
  it("R5 keeps an empty secret value empty", () => {
    expect(redactSnapshot({ controls: [control({ type: "password", value: "" })] }).controls[0]?.value).toBe("");
  });
  it("R6 keeps plain values", () => {
    const out = redactSnapshot({ controls: [control({ type: "search", name: "q", value: "red shoes" }), control({ type: "email", value: "ada@example.com" }), control({ name: "promo_code", maxLength: 8, value: "SPRING25" })] });
    expect(out.controls.map((c) => c.value)).toEqual(["red shoes", "ada@example.com", "SPRING25"]);
  });
  it("R7 returns a copy and does not change the input", () => {
    const input = { text: "pw hunter22", controls: [control({ type: "password", value: "hunter22" })] };
    const before = structuredClone(input);
    const out = redactSnapshot(input);
    expect(input).toEqual(before);
    expect(out).not.toBe(input);
  });
  it("R8 redacts card numbers and card codes", () => {
    const out = redactSnapshot({ controls: [control({ autocomplete: "cc-number", value: "4242424242424242" }), control({ autocomplete: "cc-csc", value: "123" })] });
    expect(out.controls.map((c) => c.value)).toEqual([REDACTED, REDACTED]);
  });
  it("R9 redacts a hidden password field too", () => {
    expect(redactSnapshot({ controls: [control({ type: "password", visible: false, value: "hunter22" })] }).controls[0]?.value).toBe(REDACTED);
  });
});

describe("isSecretField", () => {
  it("names the secret kinds and nothing else", () => {
    expect(isSecretField({ type: "password" })).toBe(true);
    expect(isSecretField({ autocomplete: "one-time-code" })).toBe(true);
    expect(isSecretField({ autocomplete: "cc-csc" })).toBe(true);
    expect(isSecretField({ type: "email", name: "email" })).toBe(false);
    expect(isSecretField({ name: "coupon_code", maxLength: 6 })).toBe(false);
  });
});
