// Scan the top document of a tab and classify its walls.
import { classify } from "./classify.js";
import { FoxpassError } from "./errors.js";
import { scanPage } from "./page/scan.js";
import type { PageScan, Wall } from "./types.js";

/** The parts of the WebExtension `browser` object that a scan uses. */
export interface ScanBrowser {
  webNavigation: {
    getFrame(details: { tabId: number; frameId: number }): Promise<{ url: string; documentId?: string } | null | undefined>;
  };
  scripting: {
    executeScript(injection: { target: { tabId: number; documentIds?: string[]; frameIds?: number[] }; func: () => PageScan }): Promise<{ result?: unknown }[]>;
  };
}

export interface TabScan {
  scan: PageScan;
  walls: Wall[];
  /** The document that the scan read (Firefox 153+). Pass it to `fillWall`. */
  documentId?: string;
}

/**
 * Scan the top document of a tab and classify its walls. It pins the scan to
 * the document that webNavigation reports, so a page that changes in between
 * makes executeScript fail instead of reading the wrong page.
 */
export async function scanTab(browser: ScanBrowser, tabId: number): Promise<TabScan> {
  const frame = await browser.webNavigation.getFrame({ tabId, frameId: 0 });
  if (!frame) throw new FoxpassError("no-tab", "The tab has no top document.");
  const target = frame.documentId ? { tabId, documentIds: [frame.documentId] } : { tabId, frameIds: [0] };
  const [first] = await browser.scripting.executeScript({ target, func: scanPage });
  const scan = first?.result as PageScan;
  const walls = classify(scan);
  return frame.documentId ? { scan, walls, documentId: frame.documentId } : { scan, walls };
}
