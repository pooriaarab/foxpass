// Runs in the page. It reads no field value: only if a field is empty (S1).
import type { PageScan } from "../types.js";

/**
 * Runs in the page through scripting.executeScript. Firefox sends it as
 * source text, so it must not use anything from outside its own body.
 */
export function scanPage(): PageScan {
  const clean = (text: string | null | undefined, max = 120) => (text ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  const visible = (el: Element) => {
    const box = el.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return false;
    return el.checkVisibility({ opacityProperty: true, visibilityProperty: true, checkOpacity: true, checkVisibilityCSS: true } as CheckVisibilityOptions);
  };
  const unique = (selector: string) => {
    try {
      return document.querySelectorAll(selector).length === 1;
    } catch {
      return false;
    }
  };
  const selectorOf = (el: Element): string => {
    if (el.id && unique(`#${CSS.escape(el.id)}`)) return `#${CSS.escape(el.id)}`;
    const name = el.getAttribute("name");
    const tag = el.tagName.toLowerCase();
    if (name && unique(`${tag}[name="${CSS.escape(name)}"]`)) return `${tag}[name="${CSS.escape(name)}"]`;
    const parts: string[] = [];
    for (let node: Element | null = el; node && node !== document.documentElement; node = node.parentElement) {
      const parent: Element | null = node.parentElement;
      const same = parent ? [...parent.children].filter((c) => c.tagName === node!.tagName) : [];
      parts.unshift(`${node.tagName.toLowerCase()}${same.length > 1 ? `:nth-of-type(${same.indexOf(node) + 1})` : ""}`);
    }
    return parts.join(" > ");
  };
  const forms = [...document.forms];
  const formOf = (el: { form: HTMLFormElement | null } | Element) => ("form" in el && el.form ? forms.indexOf(el.form) : -1);
  const SKIP = new Set(["hidden", "submit", "button", "image", "reset", "checkbox", "radio", "file", "range", "color"]);
  const fields = [...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input, textarea, select")]
    .filter((el) => !(el instanceof HTMLInputElement && SKIP.has(el.type)))
    .slice(0, 200)
    .map((el) => ({
      selector: selectorOf(el),
      tag: el.tagName.toLowerCase() as "input" | "textarea" | "select",
      type: el instanceof HTMLInputElement ? el.type : "",
      autocomplete: el.getAttribute("autocomplete") ?? "",
      name: clean(el.getAttribute("name")),
      id: clean(el.id),
      label: clean(el.labels?.[0]?.textContent ?? el.getAttribute("aria-label") ?? el.title),
      placeholder: clean(el.getAttribute("placeholder")),
      inputMode: el.getAttribute("inputmode") ?? "",
      maxLength: el instanceof HTMLSelectElement ? -1 : el.maxLength,
      visible: visible(el),
      filled: el.value !== "",
      form: formOf(el),
    }));
  const buttons = [...document.querySelectorAll<HTMLElement>("button, input[type=submit], input[type=button], [role=button]")].slice(0, 100).map((el) => ({
    text: clean(el instanceof HTMLInputElement ? el.value : el.textContent, 60),
    form: el instanceof HTMLButtonElement || el instanceof HTMLInputElement ? formOf(el) : -1,
    visible: visible(el),
  }));
  const headings = [...document.querySelectorAll("h1, h2")].filter(visible).slice(0, 20).map((h) => clean(h.textContent));
  const frames = [...document.querySelectorAll("iframe")].slice(0, 50).map((f) => f.src);
  const captchaMarks = ["g-recaptcha", "h-captcha", "cf-turnstile"].filter((c) => document.querySelector(`.${c}`) !== null);
  let webauthn: PageScan["webauthn"] = [];
  try {
    const parsed: unknown = JSON.parse(document.documentElement.getAttribute("data-foxpass-webauthn") ?? "[]");
    if (Array.isArray(parsed)) webauthn = parsed.slice(-10);
  } catch {
    webauthn = [];
  }
  return { url: location.href, title: clean(document.title), headings, fields, buttons, frames, captchaMarks, webauthn };
}
