/** The kinds of auth wall, in the order the user meets them. */
export type WallKind = "webauthn" | "captcha" | "oauth-consent" | "otp" | "password" | "sign-in";

/** One form field, as the page scan reads it. It never holds the value. */
export interface FieldInfo {
  /** A CSS selector that finds this field again. */
  selector: string;
  tag: "input" | "textarea" | "select";
  /** The input type in lower case, for example "password", or "" for other tags. */
  type: string;
  autocomplete: string;
  name: string;
  id: string;
  /** The label text, aria-label, or title. */
  label: string;
  placeholder: string;
  inputMode: string;
  /** The maxlength attribute, or -1 when there is none. */
  maxLength: number;
  visible: boolean;
  /** The field holds text. The text itself never leaves the page. */
  filled: boolean;
  /** The number of its form in the page, or -1 for a field outside a form. */
  form: number;
}

/** A button or submit input. */
export interface ButtonInfo {
  text: string;
  form: number;
  visible: boolean;
}

/** One WebAuthn call that the page made, as the observer saw it. It never holds the result. */
export interface WebAuthnCall {
  kind: "get" | "create";
  /** The RP ID the page asked for, or the page host when it named none. */
  rpId: string;
  state: "pending" | "fulfilled" | "rejected";
  /** A conditional (autofill) request: `mediation: "conditional"`. */
  conditional: boolean;
  /** When the call started, in ms since 1970. */
  at: number;
}

/** What `scanPage` reads from the top document of a tab. */
export interface PageScan {
  url: string;
  title: string;
  /** Text of the visible h1 and h2 elements. */
  headings: string[];
  fields: FieldInfo[];
  buttons: ButtonInfo[];
  /** The src of each iframe. */
  frames: string[];
  /** Class names of known CAPTCHA widgets on the page, for example "g-recaptcha". */
  captchaMarks: string[];
  webauthn: WebAuthnCall[];
}

/** One step that only the user can do. */
export interface Wall {
  kind: WallKind;
  /** Why foxpass thinks this is a wall, in plain words. */
  reason: string;
  /** The field to highlight, when there is one. */
  selector?: string;
  host: string;
}
