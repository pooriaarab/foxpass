// The demo agent: a foxloop run with a fixed rule planner, not a model. It
// reads the page, hands a sign-in step to the user, and reads the balance.
// `seen` keeps every message the planner got, so the E2E test can look for
// secrets in the planner context.
import { createFoxgate } from "foxgate";
import { createLoop, toolSpecs } from "foxloop";
import { handoffTool, readPageTool } from "../src/index.ts";

export const GOAL = "Read my Acorn Bank balance.";

export function ruleMind() {
  const seen = [];
  const reply = (name, args = {}) => ({
    message: { role: "assistant", content: null, tool_calls: [{ id: `call_${seen.length}`, type: "function", function: { name, arguments: JSON.stringify(args) } }] },
    provider: "rules",
  });
  return {
    seen,
    async chat(messages) {
      seen.push(structuredClone(messages));
      const last = messages.findLast((m) => m.role === "tool")?.content ?? "";
      if (last === "") return reply("read_page");
      if (last.startsWith("read_page: ok") && last.includes("Call hand_to_user")) return reply("hand_to_user", { reason: "The page asks for a sign-in step." });
      if (last.startsWith("hand_to_user: ok")) return reply("read_page");
      const balance = last.match(/Balance: (\$[\d,.]+)/);
      return reply("finish", { summary: balance ? `Your balance is ${balance[1]}.` : "I could not read the balance." });
    },
  };
}

// foxloop ends the run as done only when the newest read shows a balance.
function balanceCheck(snapshot) {
  const ok = /Balance: \$/.test(snapshot.text);
  return { ok, checks: [{ part: "the balance shows", ok, evidence: ok ? "Balance: on the page" : "no balance on the page" }] };
}

/** Run the agent on one tab. `onEvent` gets each foxloop event. */
export async function runAgent({ browser, handoff, tabId, signal, handoffTimeoutMs, onEvent }) {
  const tools = [
    readPageTool({ browser, tabId: () => tabId, check: balanceCheck }),
    handoffTool({ handoff, browser, tabId: () => tabId, request: handoffTimeoutMs ? { timeoutMs: handoffTimeoutMs } : {} }),
  ];
  const { gate, host } = createFoxgate({ tools: toolSpecs(tools) });
  const tab = await browser.tabs.get(tabId);
  await host.addGrant({ scope: "read", domains: [new URL(tab.url).hostname] });
  const mind = ruleMind();
  let last = { type: "blocked", reason: "no-events" };
  for await (const event of createLoop({ mind, gate, tools }).run(GOAL, { signal })) {
    onEvent(event);
    last = event;
  }
  return { last, seen: mind.seen };
}
