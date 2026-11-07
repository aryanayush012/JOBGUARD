// Runs on Gmail. Reads the inbox list you can see (sender, subject, preview line, date) and hands it to this
// extension's background, on your computer. The background keeps only emails about your saved jobs; nothing else
// is sent anywhere. Email bodies are never read.
(() => {
  if (window.top !== window || window.__jobguardGmail) return;
  window.__jobguardGmail = true;

  const text = (el) => (el?.innerText || el?.textContent || "").replace(/\s+/g, " ").trim();
  function rows() {
    return [...document.querySelectorAll("tr.zA")].map((row) => {
      const key = row.querySelector("[data-legacy-thread-id]")?.getAttribute("data-legacy-thread-id")
        || (row.querySelector("[data-thread-id]")?.getAttribute("data-thread-id") || "").replace(/^#?thread-f:/, "");
      const sender = row.querySelector("[email]");
      const from = sender ? `${sender.getAttribute("name") || text(sender)} <${sender.getAttribute("email")}>` : "";
      return { key, from, subject: text(row.querySelector(".bog")), snippet: text(row.querySelector(".y2")).replace(/^[-–\s]+/, ""), date: row.querySelector(".xW span[title], td.xW [title]")?.getAttribute("title") || "" };
    }).filter((r) => r.key && r.subject);
  }

  let timer;
  const scan = () => { clearTimeout(timer); timer = setTimeout(() => { const list = rows(); if (list.length) chrome.runtime.sendMessage({ type: "gmail-rows", rows: list }).catch(() => { /* extension reloaded */ }); }, 4000); };
  new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
  scan();
})();
