// Observe WebAuthn calls from the page world. The observer never starts,
// changes, or answers a ceremony: it calls the real function with the same
// arguments and returns the same promise (S3, S5). It records the kind, the
// RP ID, and the end state in a data attribute that scanPage reads.

/**
 * Wrap navigator.credentials.get and create in the page world. Call it from a
 * script that runs in the MAIN world at document_start. It is self-contained.
 */
export function observeWebAuthn(): void {
  const proto = (globalThis as unknown as { CredentialsContainer?: { prototype: Record<string, unknown> } }).CredentialsContainer?.prototype;
  const mark = Symbol.for("foxpass.webauthn-observer");
  if (!proto || mark in proto) return;
  Object.defineProperty(proto, mark, { value: true });
  const calls: { kind: string; rpId: string; state: string; conditional: boolean; at: number }[] = [];
  const write = () => document.documentElement?.setAttribute("data-foxpass-webauthn", JSON.stringify(calls.slice(-10)));
  for (const kind of ["get", "create"] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, kind);
    const real = descriptor?.value as ((this: unknown, ...args: unknown[]) => Promise<unknown>) | undefined;
    if (typeof real !== "function") continue;
    const wrapped = {
      [kind](this: unknown, ...args: unknown[]): Promise<unknown> {
        const promise = Reflect.apply(real, this, args);
        try {
          const options = args[0] as { publicKey?: { rpId?: unknown; rp?: { id?: unknown } }; mediation?: unknown } | undefined;
          const publicKey = options?.publicKey;
          if (publicKey && typeof publicKey === "object") {
            const named = kind === "get" ? publicKey.rpId : publicKey.rp?.id;
            const call = { kind, rpId: typeof named === "string" && named ? named : location.hostname, state: "pending", conditional: options?.mediation === "conditional", at: Date.now() };
            calls.push(call);
            write();
            const settle = (state: string) => () => {
              call.state = state;
              write();
            };
            Promise.resolve(promise).then(settle("fulfilled"), settle("rejected"));
          }
        } catch {
          // A page getter that throws does not change what the page gets.
        }
        return promise;
      },
    }[kind];
    Object.defineProperty(proto, kind, { ...descriptor, value: wrapped });
  }
}
