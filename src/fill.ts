// Fill one auth wall field with a foxvault secret (docs/failure-modes.md
// V1-V4). foxpass checks that the field is a password, OTP, or sign-in wall
// from the scan. foxvault then checks the secret's hosts and asks foxgate,
// so the user approves the exact host and field. The agent passes only a
// handle, and gets back a status, never the value.
import type { TabScan } from "./scan.js";
import type { WallKind } from "./types.js";

export type FillResult = { status: "filled"; host: string } | { status: "ask"; requestId: string } | { status: "refused"; reason: string };

/** The part of a foxvault vault that fillWall uses. */
export interface FillVault {
  fill(request: { handle: string; tabId: number; selector: string; token?: string; documentId?: string }): Promise<FillResult>;
}

const FILLABLE: WallKind[] = ["password", "otp", "sign-in"];

export async function fillWall(options: { vault: FillVault; handle: string; tabId: number; scan: TabScan; wall: { kind: WallKind; selector?: string }; token?: string }): Promise<FillResult> {
  const { wall, scan } = options;
  const found = scan.walls.find((w) => w.kind === wall.kind && w.selector === wall.selector);
  if (!found) return { status: "refused", reason: "not-a-wall-field" };
  if (!FILLABLE.includes(found.kind) || found.selector === undefined) return { status: "refused", reason: "wrong-kind" };
  const request = { handle: options.handle, tabId: options.tabId, selector: found.selector };
  // oxlint-disable-next-line unicorn/no-array-fill-with-reference-type -- vault.fill is foxvault's fill, not Array#fill
  return options.vault.fill({ ...request, ...(options.token ? { token: options.token } : {}), ...(scan.documentId ? { documentId: scan.documentId } : {}) });
}
