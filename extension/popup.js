const status = document.getElementById("status");
const fillButton = document.getElementById("fill");
const msg = document.getElementById("msg");
document.getElementById("settings").onclick = (e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); };

chrome.runtime.sendMessage({ type: "api", path: "/api/ext/me" }, (reply) => {
  if (reply?.ok) { status.textContent = `Connected as ${reply.data.email}`; fillButton.disabled = false; loadDue(); return; }
  // Not connected: one click opens JobGuard, which connects the extension by itself.
  status.textContent = "Not connected to your JobGuard account yet.";
  fillButton.textContent = "Connect JobGuard"; fillButton.disabled = false;
  fillButton.onclick = () => chrome.tabs.create({ url: "https://jobguard-lemon.vercel.app/profile?connect=extension" });
});

// Jobs due within 48 hours: one click opens the application, and the form fills itself there.
function loadDue() {
  chrome.runtime.sendMessage({ type: "api", path: "/api/ext/due" }, (reply) => {
    const box = document.getElementById("due");
    const jobs = reply?.ok ? reply.data.jobs : [];
    chrome.runtime.sendMessage({ type: "refresh-badge" });
    if (!jobs.length) { box.innerHTML = `<div class="muted">Nothing due in the next 48 hours.</div>`; return; }
    box.innerHTML = `<h2>Due soon</h2>`;
    for (const job of jobs) {
      const hours = Math.max(0, Math.round((new Date(job.deadlineAt) - Date.now()) / 36e5));
      const b = document.createElement("button"); b.className = "job"; b.title = "Open the application";
      const when = hours < 1 ? "due within the hour" : hours < 24 ? `due in ${hours}h` : `due in ${Math.round(hours / 24)}d`;
      b.append(Object.assign(document.createElement("b"), { textContent: job.title }),
        Object.assign(document.createElement("span"), { textContent: `${job.company}${job.referredBy ? ` · referred by ${job.referredBy}` : ""}` }),
        Object.assign(document.createElement("span"), { textContent: when, className: hours < 24 ? "soon" : "" }));
      b.onclick = () => chrome.tabs.create({ url: job.url });
      box.append(b);
    }
  });
}

// Works on any site: injects the filler into this tab (all frames, for embedded forms) and starts it.
fillButton.onclick = async () => {
  fillButton.disabled = true; msg.textContent = "Filling…";
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ["content.js"] });
    await chrome.tabs.sendMessage(tab.id, { type: "jobguard-fill" }).catch(() => {});
    msg.textContent = "Check the JobGuard panel on the page.";
  } catch (error) {
    msg.className = "err"; msg.textContent = `Can't fill this page: ${error.message}`;
  } finally { fillButton.disabled = false; }
};
