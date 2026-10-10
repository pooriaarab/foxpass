// Runs in the page. It reads the page for an agent, and masks secret values
// before they leave the page (R1, R2). The code word patterns come in as
// arguments, because a page function cannot import them.
import type { PageSnapshot } from "../types.js";

export function snapshotPage(codeWords: string, notOtp: string): PageSnapshot {
  const code = new RegExp(codeWords);
  const notCode = new RegExp(notOtp);
  const words = (text: string) =>
    text
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .toLowerCase()
      .replace(/[_\-.]+/g, " ");
  const clean = (text: string | null | undefined, max = 120) => (text ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  const secrets: string[] = [];
  const fields = [...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input, textarea, select")]
    .filter((el) => !(el instanceof HTMLInputElement && ["hidden", "submit", "button", "image", "reset", "file"].includes(el.type)))
    .slice(0, 200)
    .map((el) => {
      const type = el instanceof HTMLInputElement ? el.type : "";
      const autocomplete = (el.getAttribute("autocomplete") ?? "").toLowerCase();
      const label = clean(el.labels?.[0]?.textContent ?? el.getAttribute("aria-label") ?? el.title);
      const named = words(`${el.getAttribute("name") ?? ""} ${el.id} ${label} ${el.getAttribute("placeholder") ?? ""}`);
      // Mask more than classify calls an OTP: any field named as a code, of any length.
      const secret = type === "password" || /\b(current-password|new-password|one-time-code|cc-number|cc-csc)\b/.test(autocomplete) || (code.test(named) && !notCode.test(named));
      if (secret && el.value.length >= 4) secrets.push(el.value);
      return {
        type,
        autocomplete,
        name: clean(el.getAttribute("name")),
        id: clean(el.id),
        label,
        placeholder: clean(el.getAttribute("placeholder")),
        inputMode: el.getAttribute("inputmode") ?? "",
        maxLength: el instanceof HTMLSelectElement ? -1 : el.maxLength,
        secret,
        value: secret && el.value !== "" ? "[redacted]" : clean(el.value, 200),
      };
    });
  let text = (document.body?.innerText ?? "").slice(0, 4000);
  for (const value of secrets.toSorted((a, b) => b.length - a.length)) text = text.split(value).join("[redacted]");
  return { url: location.href, title: clean(document.title), text, fields };
}
