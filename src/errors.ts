export type FoxpassErrorCode = "bad-scan" | "bad-option" | "no-tab";

/** Every error that foxpass throws. No message holds a field value. */
export class FoxpassError extends Error {
  readonly code: FoxpassErrorCode;
  constructor(code: FoxpassErrorCode, message: string) {
    super(message);
    this.name = "FoxpassError";
    this.code = code;
  }
}
