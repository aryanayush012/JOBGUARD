// JobGuard Autofill background: talks to JobGuard for the pages, keeps the "due soon" badge fresh, and turns
// Gmail into job updates on your own computer (only emails about your saved jobs are ever sent to JobGuard).

const DEFAULT_BASE = "https://jobguard-lemon.vercel.app";
// Pages allowed to connect this extension to an account (the live site, plus localhost for development).
const isJobGuardOrigin = (origin) => origin === DEFAULT_BASE || /^http:\/\/localhost(:\d+)?$/.test(origin);

async function config() {
  return chrome.storage.local.get({ baseUrl: "", token: "", settings: { autoFill: true, emailScan: true, aiAssist: false } });
}

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer); let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

async function api(path, method = "GET", body) {
  const { baseUrl, token } = await config();
  if (!baseUrl || !token) throw new Error("Not connected yet: open your JobGuard Profile page to connect.");
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

/* ---------- Settings (chosen on the Profile page) and the "due soon" badge ---------- */
async function refresh() {
  try {
    const me = await api("/api/ext/me");
    await chrome.storage.local.set({ settings: me.settings, email: me.email });
    const { jobs } = await api("/api/ext/due");
    await chrome.action.setBadgeBackgroundColor({ color: "#fab81a" });
    await chrome.action.setBadgeText({ text: jobs.length ? String(jobs.length) : "" });
    await chrome.action.setTitle({ title: jobs.length ? `JobGuard: ${jobs.length} job${jobs.length === 1 ? "" : "s"} due within 48 hours` : "JobGuard Autofill" });
    if (me.settings.emailScan) await pollGmailFeed();
  } catch {
    await chrome.action.setBadgeText({ text: "" }); // not connected yet
  }
}

chrome.runtime.onInstalled.addListener((details) => {
  chrome.alarms.create("refresh", { periodInMinutes: 30 });
  // One-click setup: open the Profile page, which connects this extension to your account by itself.
  if (details.reason === "install") chrome.tabs.create({ url: `${DEFAULT_BASE}/profile?connect=extension` });
  void refresh();
});
chrome.runtime.onStartup.addListener(() => void refresh());
chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === "refresh") void refresh(); });

/* ---------- Gmail → job updates, filtered on this computer ---------- */
const JOB_WORDS = /\b(application|applied|applying|candidate|interview|recruit\w*|hiring|position|role|offer|referr\w*|assessment|hackerrank|codility|codesignal|shortlist\w*|regret|next steps|talent)\b/i;
let jobsCache = { at: 0, companies: [] };

async function savedCompanies() {
  if (Date.now() - jobsCache.at > 30 * 60 * 1000) {
    const { jobs } = await api("/api/ext/jobs");
    jobsCache = { at: Date.now(), companies: [...new Set(jobs.map((j) => j.company.trim().toLowerCase()).filter((c) => c.length >= 3))] };
  }
  return jobsCache.companies;
}

// Only emails that mention one of your saved companies AND look job-related leave this computer,
// and only their sender, subject, preview line and date. Everything else is ignored here.
async function handleEmails(emails) {
  rememberRecent(emails); // kept in memory for verification codes, even with email updates off
  const { settings, token } = await config();
  if (!token || !settings.emailScan || !emails.length) return;
  const { seen = [] } = await chrome.storage.local.get("seen");
  const seenSet = new Set(seen);
  const companies = await savedCompanies().catch(() => []);
  const relevant = emails.filter((e) => {
    if (seenSet.has(e.key)) return false;
    const text = `${e.from} ${e.subject} ${e.snippet}`.toLowerCase();
    return JOB_WORDS.test(text) && companies.some((c) => text.includes(c));
  });
  if (!relevant.length) return;
  for (let i = 0; i < relevant.length; i += 50) {
    await api("/api/ext/emails", "POST", { emails: relevant.slice(i, i + 50).map(({ key, from, subject, snippet, date }) => ({ key, from: from.slice(0, 300), subject: subject.slice(0, 300), snippet: snippet.slice(0, 500), date })) });
  }
  await chrome.storage.local.set({ seen: [...seen, ...relevant.map((e) => e.key)].slice(-2000) });
}

const decodeXml = (s) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&");
const tag = (xml, name) => decodeXml((new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`).exec(xml) || [])[1] || "").trim();

// Gmail's lightweight feed of unread mail (Inbox and the Updates tab), read with your existing Gmail login in this browser.
async function fetchFeed() {
  const emails = [];
  for (const label of ["", "%5Esmartlabel_notification"]) {
    try {
      const response = await fetch(`https://mail.google.com/mail/u/0/feed/atom/${label}`, { credentials: "include" });
      if (!response.ok) continue;
      const xml = await response.text();
      for (const entry of xml.split("<entry>").slice(1)) {
        const link = (/<link[^>]*href="([^"]+)"/.exec(entry) || [])[1] || "";
        const key = (/message_id=([0-9a-f]+)/i.exec(decodeXml(link)) || [])[1] || tag(entry, "id");
        const name = tag(entry, "name"); const address = tag(entry, "email");
        emails.push({ key, from: name ? `${name} <${address}>` : address, subject: tag(entry, "title"), snippet: tag(entry, "summary"), date: tag(entry, "issued") || tag(entry, "modified") });
      }
    } catch { /* not signed in to Gmail in this browser, or offline */ }
  }
  return emails;
}
async function pollGmailFeed() { await handleEmails(await fetchFeed()); }

/* ---------- Verification codes: found on this computer, never sent to JobGuard ---------- */
let recent = []; // last ~200 emails seen (feed + Gmail tab), kept in memory only
function rememberRecent(emails) {
  const byKey = new Map(recent.map((e) => [e.key, e]));
  for (const e of emails) byKey.set(e.key, { ...e, seenAt: Date.now() });
  recent = [...byKey.values()].slice(-200);
}
function extractCode(subject, text) {
  const all = `${subject}\n${text}`;
  if (!/verif|one[- ]time|otp|passcode|security code|confirm (your )?(email|account)|activate/i.test(all)) return null;
  const after = /\b(?:code|otp|passcode|pin)\s*(?:is|:)?\s*([0-9]{4,8}|(?=[a-z]*[0-9])[a-z0-9]{6,8})\b/i.exec(all);
  const before = /\b([0-9]{4,8})\s+is (?:your|the)\b/i.exec(all);
  const code = after?.[1] ?? before?.[1] ?? null;
  return code && !/^(19|20)\d{2}$/.test(code) ? code : null;
}
async function findCode(host) {
  rememberRecent(await fetchFeed());
  const since = Date.now() - 20 * 60 * 1000;
  const words = host.toLowerCase().split(".").filter((w) => w.length >= 4 && !/^(www|jobs|careers|apply|boards|com|wd\d+)$/.test(w));
  const found = recent
    .map((e) => ({ e, code: extractCode(e.subject, e.snippet), when: Date.parse(e.date) || e.seenAt }))
    .filter((x) => x.code && x.when >= since)
    .sort((a, b) => b.when - a.when);
  const best = found.find((x) => words.some((w) => `${x.e.from} ${x.e.subject}`.toLowerCase().includes(w))) || found[0];
  return best ? { code: best.code, link: null, from: best.e.from, subject: best.e.subject } : null;
}

/* ---------- Messages from pages and the popup ---------- */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const reply = (promise) => { promise.then((data) => sendResponse({ ok: true, data }), (error) => sendResponse({ ok: false, error: error.message })); return true; };
  const senderOrigin = sender.url ? new URL(sender.url).origin : "";

  switch (message?.type) {
    case "api": return reply(api(message.path, message.method, message.body));
    case "config": return reply(config().then((c) => ({ connected: Boolean(c.baseUrl && c.token), autoFill: c.settings.autoFill })));
    case "refresh": void refresh(); return;
    case "gmail-rows": void handleEmails(message.rows || []).catch(() => {}); return;
    case "verification": return reply(findCode(message.host || ""));

    // One-click connection, only from JobGuard's own pages (the bridge content script runs nowhere else).
    case "bridge-status":
      if (!isJobGuardOrigin(senderOrigin)) return;
      return reply(config().then((c) => ({ version: chrome.runtime.getManifest().version, connected: Boolean(c.token) && c.baseUrl === senderOrigin })));
    case "bridge-connect":
      if (!isJobGuardOrigin(senderOrigin) || !/^jg_[\w-]{20,}$/.test(message.token || "")) return;
      return reply(chrome.storage.local.set({ baseUrl: senderOrigin, token: message.token, seen: [] }).then(() => { void refresh(); return { connected: true }; }));
    case "bridge-disconnect":
      if (!isJobGuardOrigin(senderOrigin)) return;
      return reply(chrome.storage.local.remove(["token", "baseUrl", "settings", "seen", "email"]).then(() => { void chrome.action.setBadgeText({ text: "" }); return { connected: false }; }));
  }
});
