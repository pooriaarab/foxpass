// The demo popup. It picks the web tab the user was on last (D1), shows the
// agent's state for it (D2), and asks for site access when needed (D3).
// It shows statuses and summaries only, never a field value (D4).
const $ = (id) => document.getElementById(id);
const isWeb = (url) => /^https?:/.test(url ?? "");
let tab;

async function pickTab() {
  const tabs = await browser.tabs.query({ lastFocusedWindow: true });
  return tabs.filter((t) => isWeb(t.url)).toSorted((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))[0];
}

// A match pattern has no port: it covers every port of the host.
const originOf = (url) => `${new URL(url).protocol}//${new URL(url).hostname}/*`;

function render(state) {
  $("site").textContent = state.host;
  $("allow").hidden = state.permitted;
  $("run").hidden = !state.permitted || state.status === "running";
  $("stop").hidden = state.status !== "running";
  const status = $("status");
  if (state.status === "running" && state.waiting) {
    status.dataset.state = "waiting";
    status.textContent = `Waiting for you: the ${state.waiting} step on ${state.host}. Do it in the page. The agent cannot see what you type.`;
  } else if (state.status === "running") {
    status.dataset.state = "running";
    status.textContent = "The agent is working.";
  } else if (state.status === "done") {
    status.dataset.state = "done";
    status.textContent = `Done: ${state.summary}`;
  } else if (state.status) {
    status.dataset.state = "stopped";
    status.textContent = `Stopped (${state.status}): ${state.summary}`;
  }
  $("steps").replaceChildren(
    ...state.steps.map((line) => {
      const li = document.createElement("li");
      li.textContent = line;
      return li;
    }),
  );
}

async function refresh() {
  if (!tab) return;
  render(await browser.runtime.sendMessage({ type: "popup-state", tabId: tab.id }));
}

$("allow").addEventListener("click", async () => {
  // permissions.request must run in the click handler, before any await.
  const granted = await browser.permissions.request({ origins: [originOf(tab.url)] });
  if (granted) $("status").textContent = "Access granted. Reload the page, so foxpass can see passkey prompts there.";
  await refresh();
});
$("run").addEventListener("click", async () => {
  await browser.runtime.sendMessage({ type: "run", tabId: tab.id });
  await refresh();
});
$("stop").addEventListener("click", () => browser.runtime.sendMessage({ type: "stop", tabId: tab.id }));

pickTab().then((picked) => {
  tab = picked;
  if (!tab) return;
  document.body.dataset.tab = String(tab.id);
  refresh();
  setInterval(refresh, 500);
});
