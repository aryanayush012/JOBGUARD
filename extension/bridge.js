// Runs only on JobGuard's own pages (see manifest). Lets the Profile page see that the extension is installed
// and connect it to your account in one step, with no token to copy.
document.documentElement.dataset.jobguardExtension = chrome.runtime.getManifest().version;

window.addEventListener("message", (event) => {
  if (event.source !== window || event.origin !== location.origin || event.data?.source !== "jobguard-page") return;
  const { type, token, requestId } = event.data;
  if (!["status", "connect", "disconnect"].includes(type)) return;
  chrome.runtime.sendMessage({ type: `bridge-${type}`, token }, (reply) => {
    window.postMessage({ source: "jobguard-extension", requestId, ...(reply || { ok: false, error: chrome.runtime.lastError?.message || "No reply" }) }, location.origin);
  });
});
