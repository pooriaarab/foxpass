// Scan the top document of a tab and classify its walls.
import { CODE_WORDS, NOT_OTP, classify } from "./classify.js";
import { FoxpassError } from "./errors.js";
import { scanPage } from "./page/scan.js";
import { snapshotPage } from "./page/snapshot.js";
import { redactSnapshot } from "./redact.js";
import type { PageScan, PageSnapshot, Wall } from "./types.js";

/** The parts of the WebExtension `browser` object that a scan uses. */
export interface ScanBrowser {
  webNavigation: {
    getFrame(details: { tabId: number; frameId: number }): Promise<{ url: string; documentId?: string } | null | undefined>;
  };
  scripting: {
    executeScript(injection: { target: { tabId: number; documentIds?: string[]; frameIds?: number[] }; func: (...args: string[]) => PageScan | PageSnapshot; args?: string[] }): Promise<{ result?: unknown }[]>;
  };
}

export interface TabScan {
  scan: PageScan;
  walls: Wall[];
  /** The document that the scan read (Firefox 153+). Pass it to `fillWall`. */
  documentId?: string;
}

async function topDocument(browser: ScanBrowser, tabId: number) {
  const frame = await browser.webNavigation.getFrame({ tabId, frameId: 0 });
  if (!frame) throw new FoxpassError("no-tab", "The tab has no top document.");
  const target = frame.documentId ? { tabId, documentIds: [frame.documentId] } : { tabId, frameIds: [0] };
  return { frame, target };
}

/**
 * Scan the top document of a tab and classify its walls. It pins the scan to
 * the document that webNavigation reports, so a page that changes in between
 * makes executeScript fail instead of reading the wrong page.
 */
export async function scanTab(browser: ScanBrowser, tabId: number): Promise<TabScan> {
  const { frame, target } = await topDocument(browser, tabId);
  const [first] = await browser.scripting.executeScript({ target, func: scanPage });
  const scan = first?.result as PageScan;
  const walls = classify(scan);
  return frame.documentId ? { scan, walls, documentId: frame.documentId } : { scan, walls };
}

/**
 * Read the top document of a tab for an agent: its text and fields. Secret
 * values are masked in the page, so they never leave it, and redactSnapshot
 * runs again on the result.
 */
export async function readTab(browser: ScanBrowser, tabId: number): Promise<PageSnapshot> {
  const { target } = await topDocument(browser, tabId);
  const [first] = await browser.scripting.executeScript({ target, func: snapshotPage, args: [CODE_WORDS.source, NOT_OTP.source] });
  return redactSnapshot(first?.result as PageSnapshot);
}
