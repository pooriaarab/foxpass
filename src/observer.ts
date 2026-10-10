// Register the page-world WebAuthn observer (src/page/observer.ts).

/** The parts of the WebExtension `browser` object that the observer setup uses. */
export interface ObserverBrowser {
  scripting: {
    getRegisteredContentScripts(filter: { ids: string[] }): Promise<{ id: string }[]>;
    registerContentScripts(scripts: ContentScript[]): Promise<void>;
    updateContentScripts(scripts: ContentScript[]): Promise<void>;
  };
}

interface ContentScript {
  id: string;
  js: string[];
  matches: string[];
  runAt: "document_start";
  world: "MAIN";
  allFrames: boolean;
  persistAcrossSessions: boolean;
}

export const OBSERVER_ID = "foxpass-webauthn-observer";

/**
 * Register `js` (a bundled file that calls observeWebAuthn) as a MAIN world
 * content script at document_start, on every page the extension can reach.
 */
export async function registerWebAuthnObserver(browser: ObserverBrowser, options: { js: string; matches?: string[] }): Promise<void> {
  const script: ContentScript = {
    id: OBSERVER_ID,
    js: [options.js],
    matches: options.matches ?? ["http://*/*", "https://*/*"],
    runAt: "document_start",
    world: "MAIN",
    allFrames: false,
    persistAcrossSessions: true,
  };
  const existing = await browser.scripting.getRegisteredContentScripts({ ids: [OBSERVER_ID] });
  await (existing.length ? browser.scripting.updateContentScripts([script]) : browser.scripting.registerContentScripts([script]));
}
