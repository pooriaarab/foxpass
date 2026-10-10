// Runs in the page. Show the user what to do, outline the wall field, and
// focus the first empty field of its form. It never reads or types a value.

export function showBanner(selector: string | null, message: string): boolean {
  document.getElementById("foxpass-banner")?.remove();
  for (const el of document.querySelectorAll("[data-foxpass-highlight]")) el.removeAttribute("data-foxpass-highlight");
  const host = document.createElement("div");
  host.id = "foxpass-banner";
  const root = host.attachShadow({ mode: "open" });
  const box = document.createElement("div");
  box.setAttribute("role", "alert");
  box.style.cssText = "position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483647;max-width:min(36rem,90vw);padding:12px 16px;border-radius:10px;background:#20123a;color:#fff;font:15px/1.4 system-ui,sans-serif;box-shadow:0 4px 18px #0006;border:2px solid #ff9500";
  const title = document.createElement("strong");
  title.textContent = "The agent paused. Your turn.";
  const text = document.createElement("div");
  text.textContent = message;
  const note = document.createElement("div");
  note.style.cssText = "opacity:.8;font-size:13px;margin-top:4px";
  note.textContent = "The agent cannot see what you type here. It goes on when you finish.";
  box.append(title, text, note);
  root.append(box);
  document.documentElement.append(host);
  if (!document.getElementById("foxpass-style")) {
    const style = document.createElement("style");
    style.id = "foxpass-style";
    style.textContent = "[data-foxpass-highlight]{outline:3px solid #ff9500 !important;outline-offset:2px !important}";
    (document.head ?? document.documentElement).append(style);
  }
  const field = selector ? document.querySelector<HTMLInputElement>(selector) : null;
  if (!field) return false;
  field.setAttribute("data-foxpass-highlight", "true");
  field.scrollIntoView({ block: "center" });
  const inForm = field.form ? [...field.form.elements].filter((el): el is HTMLInputElement => el instanceof HTMLInputElement && !["hidden", "submit", "button", "checkbox", "radio"].includes(el.type) && el.getClientRects().length > 0) : [];
  const firstEmpty = inForm.slice(0, inForm.indexOf(field) + 1).find((el) => el.value === "");
  (firstEmpty ?? field).focus();
  return true;
}

export function clearBanner(): void {
  document.getElementById("foxpass-banner")?.remove();
  document.getElementById("foxpass-style")?.remove();
  for (const el of document.querySelectorAll("[data-foxpass-highlight]")) el.removeAttribute("data-foxpass-highlight");
}
