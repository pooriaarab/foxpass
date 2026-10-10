// Take password, OTP, and card values out of a page snapshot before an
// agent reads it (docs/failure-modes.md R1-R9).
import { otpReason, type FieldHints } from "./classify.js";

export const REDACTED = "[redacted]";

/** A field in a snapshot from any reader: foxpaw controls, foxpass fields, or your own. */
export interface SnapshotField extends FieldHints {
  value?: string;
  /** foxpaw marks password fields `secret: true`. */
  secret?: boolean;
  [key: string]: unknown;
}

const SECRET_AUTOCOMPLETE = /\b(current-password|new-password|one-time-code|cc-number|cc-csc)\b/;
/** Values this short also occur as plain text (for example "123"), so only the field value is redacted. */
const MIN_TEXT_MATCH = 4;

/** True for a password, one-time code, card number, or card code field. */
export function isSecretField(field: SnapshotField): boolean {
  if (field.secret === true || field.type === "password") return true;
  if (SECRET_AUTOCOMPLETE.test((field.autocomplete ?? "").toLowerCase())) return true;
  return otpReason(field) !== undefined;
}

function replaceAll(value: unknown, secrets: string[]): unknown {
  if (typeof value === "string") return secrets.reduce((text, secret) => text.split(secret).join(REDACTED), value);
  if (Array.isArray(value)) return value.map((item) => replaceAll(item, secrets));
  if (typeof value === "object" && value !== null) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceAll(item, secrets)]));
  return value;
}

/**
 * Return a copy of the snapshot in which each secret field value is
 * `[redacted]` (an empty value stays empty), and each secret value of 4 or
 * more characters is replaced in every other string too. Fields are read
 * from `controls` (foxpaw) and `fields` (foxpass).
 */
export function redactSnapshot<T extends { controls?: SnapshotField[]; fields?: SnapshotField[] }>(snapshot: T): T {
  const lists = [snapshot.controls ?? [], snapshot.fields ?? []];
  const secrets = lists
    .flat()
    .filter((f) => isSecretField(f) && typeof f.value === "string" && f.value.length >= MIN_TEXT_MATCH)
    .map((f) => f.value as string)
    .toSorted((a, b) => b.length - a.length);
  const copy = replaceAll(snapshot, secrets) as T;
  for (const key of ["controls", "fields"] as const) {
    const list = copy[key];
    const original = snapshot[key];
    if (!Array.isArray(list) || !Array.isArray(original)) continue;
    list.forEach((field, i) => {
      const source = original[i];
      if (source && isSecretField(source) && typeof field.value === "string" && field.value !== "") field.value = REDACTED;
    });
  }
  return copy;
}
