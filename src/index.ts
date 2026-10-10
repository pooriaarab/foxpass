export { FoxpassError, type FoxpassErrorCode } from "./errors.js";
export { classify } from "./classify.js";
export { scanTab, type ScanBrowser, type TabScan } from "./scan.js";
export { scanPage } from "./page/scan.js";
export { OBSERVER_ID, registerWebAuthnObserver, type ObserverBrowser } from "./observer.js";
export { observeWebAuthn } from "./page/observer.js";
export type { ButtonInfo, FieldInfo, PageScan, Wall, WallKind, WebAuthnCall } from "./types.js";
