// Fallback only: normally the extension connects itself from your JobGuard Profile page.
const $ = (id) => document.getElementById(id);
const result = $("result");

chrome.storage.local.get({ baseUrl: "", token: "" }).then((c) => { $("baseUrl").value = c.baseUrl; $("token").value = c.token; });

$("save").onclick = async () => {
  let origin;
  try { origin = new URL($("baseUrl").value.trim()).origin; } catch { result.className = "err"; result.textContent = "Enter your JobGuard URL."; return; }
  if (!/^https:\/\/jobguard-lemon\.vercel\.app$|^http:\/\/localhost(:\d+)?$/.test(origin)) { result.className = "err"; result.textContent = "This extension only connects to https://jobguard-lemon.vercel.app (or localhost for development)."; return; }
  await chrome.storage.local.set({ baseUrl: origin, token: $("token").value.trim() });
  result.className = "muted"; result.textContent = "Testing…";
  chrome.runtime.sendMessage({ type: "api", path: "/api/ext/me" }, (reply) => {
    if (reply?.ok) { result.className = "ok"; result.textContent = `Connected as ${reply.data.email}.`; chrome.runtime.sendMessage({ type: "refresh" }); }
    else { result.className = "err"; result.textContent = reply?.error || "Couldn't connect."; }
  });
};
