const $ = (id) => document.getElementById(id);
const result = $("result");

chrome.storage.local.get({ baseUrl: "", token: "", autoFill: true }).then((c) => {
  $("baseUrl").value = c.baseUrl; $("token").value = c.token; $("autoFill").checked = c.autoFill;
});

$("save").onclick = async () => {
  let origin;
  try { origin = new URL($("baseUrl").value.trim()).origin; } catch { result.className = "err"; result.textContent = "Enter your JobGuard URL, e.g. https://your-app.vercel.app"; return; }
  // localhost and *.vercel.app are allowed up front; any other domain needs your permission once.
  const granted = await chrome.permissions.request({ origins: [`${origin}/*`] }).catch(() => false);
  if (!granted && !/^http:\/\/localhost(:\d+)?$|\.vercel\.app$/.test(origin)) { result.className = "err"; result.textContent = "Permission to reach that URL was declined."; return; }
  await chrome.storage.local.set({ baseUrl: origin, token: $("token").value.trim(), autoFill: $("autoFill").checked });
  result.className = "muted"; result.textContent = "Testing…";
  chrome.runtime.sendMessage({ type: "api", path: "/api/ext/me" }, (reply) => {
    if (reply?.ok) { result.className = "ok"; result.textContent = `Connected as ${reply.data.email}.`; }
    else { result.className = "err"; result.textContent = reply?.error || "Couldn't connect."; }
  });
};
