// A MAIN world content script at document_start. The background registers
// it with registerWebAuthnObserver. It only watches WebAuthn calls.
import { observeWebAuthn } from "../src/page/observer.ts";

observeWebAuthn();
