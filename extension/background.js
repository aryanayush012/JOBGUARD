// Talks to JobGuard on behalf of the content script (pages can't call JobGuard directly: different origin).

async function config() {
  return chrome.storage.local.get({ baseUrl: "", token: "", autoFill: true });
}

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer); let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

async function api(path, method = "GET", body) {
  const { baseUrl, token } = await config();
  if (!baseUrl || !token) throw new Error("Connect JobGuard first: open the extension's settings.");
  const response = await fetch(baseUrl.replace(/\/$/, "") + path, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  if (path === "/api/ext/resume" && response.ok) {
    return { base64: toBase64(await response.arrayBuffer()), fileName: decodeURIComponent(response.headers.get("x-file-name") || "resume.pdf") };
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `JobGuard request failed (${response.status}).`);
  return data;
}

// Toolbar badge: how many unapplied jobs are due within 48 hours. Refreshed every 30 minutes and when settings change.
async function refreshBadge() {
  try {
    const { jobs } = await api("/api/ext/due");
    await chrome.action.setBadgeBackgroundColor({ color: "#fab81a" });
    await chrome.action.setBadgeText({ text: jobs.length ? String(jobs.length) : "" });
    await chrome.action.setTitle({ title: jobs.length ? `JobGuard: ${jobs.length} job${jobs.length === 1 ? "" : "s"} due within 48 hours` : "JobGuard Autofill" });
  } catch {
    await chrome.action.setBadgeText({ text: "" }); // not connected yet
  }
}
chrome.runtime.onInstalled.addListener(() => { chrome.alarms.create("due", { periodInMinutes: 30 }); void refreshBadge(); });
chrome.runtime.onStartup.addListener(() => void refreshBadge());
chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === "due") void refreshBadge(); });
chrome.storage.onChanged.addListener(() => void refreshBadge());

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "refresh-badge") { void refreshBadge(); return; }
  if (message?.type === "api") {
    api(message.path, message.method, message.body).then((data) => sendResponse({ ok: true, data }), (error) => sendResponse({ ok: false, error: error.message }));
    return true; // async response
  }
  if (message?.type === "config") {
    config().then((c) => sendResponse({ ok: true, data: { autoFill: c.autoFill, connected: Boolean(c.baseUrl && c.token) } }));
    return true;
  }
});
