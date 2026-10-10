// The demo background (an MV3 event page). The logic is in demo/core.js.
// The release build answers the popup only.
import { createDemo } from "../demo/core.js";

const demo = createDemo(browser);
browser.runtime.onMessage.addListener((message) => demo.handlePopup(message));
