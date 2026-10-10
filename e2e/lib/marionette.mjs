// A small Marionette client. WebDriver BiDi has no WebAuthn commands, and
// Firefox allows one WebDriver session at a time, so the passkey test drives
// Firefox over Marionette (WebDriver classic) instead of Puppeteer.
// Protocol: each message is "<byte length>:<JSON>". A command is
// [0, id, name, params], and a reply is [1, id, error, result].
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findFirefox } from "create-foxkit/e2e";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function connect(port) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1");
    const waiting = new Map();
    let buffer = Buffer.alloc(0);
    let id = 0;
    let greeted = false;
    socket.on("error", reject);
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        const colon = buffer.indexOf(58);
        if (colon < 0) return;
        const length = Number(buffer.subarray(0, colon).toString());
        if (buffer.length < colon + 1 + length) return;
        const message = JSON.parse(buffer.subarray(colon + 1, colon + 1 + length).toString());
        buffer = buffer.subarray(colon + 1 + length);
        if (!greeted) {
          greeted = true;
          resolve({ send, close: () => socket.destroy() });
          continue;
        }
        const [, replyId, error, result] = message;
        const entry = waiting.get(replyId);
        waiting.delete(replyId);
        if (error) entry?.reject(new Error(`${error.error}: ${error.message}`));
        else entry?.resolve(result?.value === undefined ? result : result.value);
      }
    });
    function send(name, params = {}) {
      const text = JSON.stringify([0, ++id, name, params]);
      socket.write(`${Buffer.byteLength(text)}:${text}`);
      return new Promise((res, rej) => waiting.set(id, { resolve: res, reject: rej }));
    }
  });
}

/** Start Firefox with Marionette on `port`, with a fresh profile and `prefs`. */
export async function launchMarionette({ port = 28290, prefs = {}, headless = true } = {}) {
  const profile = mkdtempSync(join(tmpdir(), "foxpass-marionette-"));
  const all = { "marionette.port": port, "browser.shell.checkDefaultBrowser": false, "datareporting.policy.dataSubmissionEnabled": false, ...prefs };
  writeFileSync(join(profile, "user.js"), Object.entries(all).map(([k, v]) => `user_pref(${JSON.stringify(k)}, ${JSON.stringify(v)});`).join("\n"));
  const flags = ["-marionette", "-remote-allow-system-access", "-no-remote", "-profile", profile, ...(headless ? ["-headless"] : [])];
  const firefox = spawn(findFirefox(), flags, { stdio: "ignore" });
  let client;
  for (let i = 0; i < 150 && !client; i++) client = await connect(port).catch(() => sleep(200).then(() => undefined));
  if (!client) throw new Error("Marionette did not start");
  const capabilities = await client.send("WebDriver:NewSession", { capabilities: {} });
  const run = async (script, args = [], context = "content") => {
    await client.send("Marionette:SetContext", { value: context });
    try {
      const result = await client.send("WebDriver:ExecuteAsyncScript", { script: `const done = arguments[arguments.length - 1]; (async () => { ${script} })().then(done, (e) => done({ thrown: String(e) }));`, args, scriptTimeout: 30000 });
      if (result && typeof result === "object" && "thrown" in result) throw new Error(result.thrown);
      return result;
    } finally {
      // Window commands work only in the content context.
      if (context !== "content") await client.send("Marionette:SetContext", { value: "content" });
    }
  };
  return {
    send: client.send,
    version: capabilities.capabilities?.browserVersion,
    /** Run an async function body in the current tab (content) or in the browser (chrome). Use `arguments[0]...` for args. */
    run,
    async close() {
      await client.send("Marionette:Quit", { flags: ["eForceQuit"] }).catch(() => undefined);
      client.close();
      firefox.kill();
      await sleep(300);
      rmSync(profile, { recursive: true, force: true });
    },
  };
}
