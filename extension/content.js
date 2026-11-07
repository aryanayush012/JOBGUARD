// JobGuard Autofill: fills application forms from your answer bank. It never clicks Submit.
(() => {
  if (window.__jobguard) return;
  window.__jobguard = true;

  const send = (message) => new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (reply) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (reply?.ok) resolve(reply.data); else reject(new Error(reply?.error || "Extension error."));
    });
  });
  const api = (path, method, body) => send({ type: "api", path, method, body });

  /* ---------- Finding questions ---------- */
  const text = (el) => (el?.innerText || el?.textContent || "").replace(/\s+/g, " ").trim();
  const clean = (label) => label.replace(/\*/g, " ").replace(/\((required|optional)\)/gi, " ").replace(/\s+/g, " ").trim().slice(0, 300);
  const isVisible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };

  function labelFor(el) {
    if (el.id) { const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (text(l)) return text(l); }
    const ids = el.getAttribute("aria-labelledby");
    if (ids) { const t = ids.split(/\s+/).map((id) => text(document.getElementById(id))).join(" ").trim(); if (t) return t; }
    if (el.getAttribute("aria-label")) return el.getAttribute("aria-label");
    const wrap = el.closest("label"); if (text(wrap)) return text(wrap);
    const legend = el.closest("fieldset")?.querySelector("legend"); if (text(legend)) return text(legend);
    // Custom layouts (Workday etc.): nearest label-like element in the surrounding containers.
    let parent = el.parentElement;
    for (let i = 0; i < 4 && parent; i++, parent = parent.parentElement) {
      const l = parent.querySelector("label, legend, [data-automation-id*='formLabel'], [class*='label' i]");
      if (l && !l.contains(el) && text(l) && text(l).length < 300) return text(l);
    }
    return el.getAttribute("placeholder") || el.name || "";
  }

  let handled = new WeakSet(); // elements already processed, so new form steps don't re-ask the server
  let counter = 0;
  const SKIP_TYPES = ["hidden", "submit", "button", "reset", "image", "checkbox", "password"];
  // A field worth looking at: visible, editable, and a kind we fill (password fields are never touched).
  const candidate = (el) => !el.disabled && !el.readOnly && isVisible(el) && !SKIP_TYPES.includes((el.getAttribute("type") || "").toLowerCase());

  const CODE_LABEL = /verification code|one[- ]time|\botp\b|passcode|security code|enter (the )?code|confirmation code/i;
  let codeInput = null; // a "verification code" box: filled from Gmail on request, never sent to the AI

  function collect() {
    const questions = []; const targets = new Map(); let resumeInput = null;
    const add = (label, target, options) => {
      label = clean(label); if (!label) return;
      const id = `q${counter++}`; questions.push({ id, label, ...(options ? { options } : {}) }); targets.set(id, target);
    };
    for (const el of document.querySelectorAll("input, textarea, select")) {
      if (handled.has(el) || !candidate(el)) continue;
      const type = (el.getAttribute("type") || "text").toLowerCase();
      if (el.tagName === "INPUT" && type === "file") {
        handled.add(el);
        const hint = `${labelFor(el)} ${el.name} ${el.id} ${el.accept}`.toLowerCase();
        if (!resumeInput && /resume|cv|pdf/.test(hint) && !/cover/.test(hint) && !el.files?.length) resumeInput = el;
        continue;
      }
      if (el.tagName === "SELECT") {
        handled.add(el);
        const options = [...el.options].map((o) => o.text.trim()).filter(Boolean);
        const placeholder = el.selectedIndex <= 0 || /^(select|choose|--)/i.test(el.options[el.selectedIndex]?.text || "");
        if (placeholder && options.length) add(labelFor(el), { kind: "select", el }, options);
        continue;
      }
      if (el.tagName === "INPUT" && type === "radio") {
        const group = el.name ? [...document.querySelectorAll(`input[type=radio][name="${CSS.escape(el.name)}"]`)] : [el];
        group.forEach((r) => handled.add(r));
        if (group.some((r) => r.checked)) continue;
        const container = el.closest("fieldset, [role=radiogroup]") || el.parentElement?.parentElement;
        const groupLabel = container?.querySelector("legend")?.textContent || container?.getAttribute("aria-label") || labelFor(container || el);
        add(groupLabel, { kind: "radio", group }, group.map((r) => text(r.closest("label")) || labelFor(r)));
        continue;
      }
      handled.add(el);
      if (el.tagName === "INPUT" && CODE_LABEL.test(`${labelFor(el)} ${el.name} ${el.id} ${el.autocomplete}`)) { codeInput = el; continue; }
      if ((el.tagName === "TEXTAREA" || ["text", "email", "tel", "url", "number", "search"].includes(type)) && !el.value) add(labelFor(el), { kind: "text", el }); // never overwrite what you typed
    }
    return { questions, targets, resumeInput };
  }

  /* ---------- Filling ---------- */
  function setValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value); // native setter, so React-built forms notice
    for (const type of ["input", "change", "blur"]) el.dispatchEvent(new Event(type, { bubbles: true }));
  }
  function mark(el, source) { el.style.outline = `2px solid ${source === "AI" ? "#a78bfa" : "#fab81a"}`; el.style.outlineOffset = "2px"; el.dataset.jobguard = source; }

  function fill(target, value, source) {
    if (target.kind === "text") { setValue(target.el, value); mark(target.el, source); return target.el; }
    if (target.kind === "select") {
      const option = [...target.el.options].find((o) => o.text.trim() === value);
      if (!option) return null;
      setValue(target.el, option.value); mark(target.el, source); return target.el;
    }
    const radio = target.group.find((r) => (text(r.closest("label")) || labelFor(r)) === value);
    if (!radio) return null;
    radio.click(); mark(radio.closest("label") || radio, source); return radio;
  }

  async function attachResume(input) {
    const { base64, fileName } = await api("/api/ext/resume");
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], fileName, { type: "application/pdf" }));
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    mark(input, "BANK");
  }

  /* ---------- One pass over the page ---------- */
  const state = { filled: 0, drafts: [], skipped: 0, resume: "", job: null, error: "", verification: null };

  // Account sign-up on application sites: fetch the code/link the site just emailed you (read from your Gmail).
  async function getVerification() {
    state.verification = { loading: true }; panel.render("done");
    try { state.verification = await api(`/api/ext/verification?host=${encodeURIComponent(location.hostname)}`); }
    catch (e) { state.verification = { error: e.message }; }
    panel.render("done");
  }
  let running = false;

  async function run() {
    if (running) return; running = true; panel.render("working");
    try {
      const { questions, targets, resumeInput } = collect();
      if (resumeInput) {
        try { await attachResume(resumeInput); state.resume = "attached"; } catch (e) { state.resume = e.message; }
      }
      if (questions.length) {
        const result = await api("/api/ext/fill", "POST", { url: location.href, questions });
        state.job = result.job || state.job;
        state.skipped += result.skipped.length;
        if (result.aiError) state.error = result.aiError;
        for (const answer of result.answers) {
          const target = targets.get(answer.id); if (!target) continue;
          const el = fill(target, answer.value, answer.source);
          if (!el) continue;
          if (answer.source === "AI") {
            const label = questions.find((q) => q.id === answer.id).label;
            // "Why this company?" answers are never reused (JobGuard keeps them per company), so don't suggest saving them.
            const perCompany = /why (do you want|are you interested|join|this (role|company|position|team)|us\b)|what (excites|interests|attracts) you/i.test(label) || (state.job?.company && label.toLowerCase().includes(state.job.company.toLowerCase()));
            state.drafts.push({ label, target, save: !perCompany });
          }
          else state.filled++;
        }
      }
    } catch (e) { state.error = e.message; }
    running = false; panel.render("done");
  }

  /* ---------- Review panel (isolated from the page's styles) ---------- */
  const panel = (() => {
    const host = document.createElement("div"); host.style.cssText = "position:fixed;right:20px;bottom:20px;z-index:2147483647";
    const root = host.attachShadow({ mode: "open" });
    let open = true;
    const css = `
      .card{font:13px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;color:#f5f6f7;background:#17191d;border:1px solid #2b2f36;border-radius:16px;box-shadow:0 18px 50px rgba(0,0,0,.5);width:320px;max-height:70vh;display:flex;flex-direction:column}
      .head{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid #2b2f36}.brand{font-weight:800;letter-spacing:-.03em}.brand span{color:#fab81a}
      .x{margin-left:auto;background:none;border:0;color:#a7adb7;font-size:18px;cursor:pointer}
      .body{padding:12px 14px;overflow:auto;display:grid;gap:10px}.muted{color:#a7adb7}.err{color:#ff8b8b}
      .row{display:flex;gap:8px;align-items:center}.dot{width:10px;height:10px;border-radius:3px;flex:none}
      .q{border:1px solid #2b2f36;border-radius:10px;padding:8px;display:grid;gap:6px}.q label{display:flex;gap:6px;align-items:flex-start;color:#a7adb7}
      button.main{background:#fab81a;color:#17130a;border:0;border-radius:10px;padding:10px 12px;font-weight:700;cursor:pointer}
      button.ghost{background:none;color:#f5f6f7;border:1px solid #2b2f36;border-radius:10px;padding:8px 12px;cursor:pointer}
      .pill{background:#fab81a;color:#17130a;border:0;border-radius:999px;padding:10px 14px;font:700 13px system-ui;cursor:pointer;box-shadow:0 10px 30px rgba(0,0,0,.45)}`;
    function render(phase) {
      if (!document.body.contains(host)) document.body.appendChild(host);
      if (!open) { root.innerHTML = `<style>${css}</style><button class="pill">JobGuard${state.drafts.length ? ` · ${state.drafts.filter((d) => d.save).length} to review` : ""}</button>`; root.querySelector(".pill").onclick = () => { open = true; render(phase); }; return; }
      const job = state.job ? `<div class="muted">${esc(state.job.title || "Role")} · ${esc(state.job.company)}</div>` : "";
      const body = phase === "idle" ? `<div class="muted">Fill this application from your JobGuard answers. You review and submit.</div><button class="main">Fill this application</button>`
        : phase === "working" ? `<div class="muted">Filling… AI drafts can take up to 30 seconds.</div>`
        : `${job}
          <div class="row"><span class="dot" style="background:#fab81a"></span>${state.filled} filled from your answers</div>
          ${state.resume === "attached" ? `<div class="row"><span class="dot" style="background:#fab81a"></span>Resume attached</div>` : state.resume ? `<div class="err">Resume: ${esc(state.resume)}</div>` : ""}
          ${state.drafts.length ? `<div class="row"><span class="dot" style="background:#a78bfa"></span>${state.drafts.length} AI draft${state.drafts.length === 1 ? "" : "s"}: check them in the form</div>` : ""}
          ${state.skipped ? `<div class="muted">${state.skipped} personal question${state.skipped === 1 ? "" : "s"} (gender, disability…) left for you</div>` : ""}
          ${state.error ? `<div class="err">${esc(state.error)}</div>` : ""}
          ${state.drafts.length ? `<div class="muted">Edit drafts in the form, then save the ones worth reusing:</div>${state.drafts.map((d, i) => `<div class="q"><label><input type="checkbox" data-i="${i}" ${d.save ? "checked" : ""}>${esc(d.label)}</label></div>`).join("")}<button class="main save">Save checked to my answers</button>` : ""}
          <div class="muted">Review everything, then submit the form yourself.</div>
          ${verificationHtml()}
          <button class="ghost again">Fill again</button>`;
      root.innerHTML = `<style>${css}</style><div class="card" role="dialog" aria-label="JobGuard Autofill"><div class="head"><div class="brand">JOB<span>GUARD</span></div><button class="x" aria-label="Minimise">–</button></div><div class="body">${body}</div></div>`;
      root.querySelector(".x").onclick = () => { open = false; render(phase); };
      root.querySelector("button.main:not(.save)")?.addEventListener("click", () => void run());
      root.querySelector(".getcode")?.addEventListener("click", () => void getVerification());
      root.querySelector(".pastecode")?.addEventListener("click", () => {
        if (codeInput && state.verification?.code) { setValue(codeInput, state.verification.code); mark(codeInput, "BANK"); }
      });
      root.querySelector(".openlink")?.addEventListener("click", () => { if (/^https:\/\//.test(state.verification?.link || "")) window.open(state.verification.link, "_blank", "noopener"); });
      root.querySelector(".again")?.addEventListener("click", () => {
        // Start over: look at every field again (filled ones are still skipped, so nothing you typed is overwritten).
        handled = new WeakSet(); Object.assign(state, { filled: 0, drafts: [], skipped: 0, resume: "", error: "" });
        void run();
      });
      root.querySelectorAll("input[data-i]").forEach((box) => box.addEventListener("change", () => { state.drafts[box.dataset.i].save = box.checked; }));
      root.querySelector(".save")?.addEventListener("click", async (e) => {
        const answers = state.drafts.filter((d) => d.save).map((d) => ({ label: d.label, value: currentValue(d.target) })).filter((a) => a.value);
        if (!answers.length) return;
        e.target.disabled = true; e.target.textContent = "Saving…";
        try { const { saved } = await api("/api/ext/answers", "POST", { company: state.job?.company, answers }); e.target.textContent = `Saved ${saved} ✓`; state.drafts = state.drafts.filter((d) => !d.save); }
        catch (err) { e.target.disabled = false; e.target.textContent = "Save checked to my answers"; state.error = err.message; render("done"); }
      });
    }
    return { render };
  })();

  function currentValue(target) {
    if (target.kind === "text") return target.el.value.trim();
    if (target.kind === "select") return target.el.options[target.el.selectedIndex]?.text.trim() || "";
    const checked = target.group.find((r) => r.checked);
    return checked ? (text(checked.closest("label")) || labelFor(checked)) : "";
  }
  function verificationHtml() {
    const v = state.verification;
    if (!v) return `<button class="ghost getcode">${codeInput ? "Get verification code from Gmail" : "Get email verification code / link"}</button>`;
    if (v.loading) return `<div class="muted">Checking your Gmail…</div>`;
    if (v.error) return `<div class="err">${esc(v.error)}</div><button class="ghost getcode">Try again</button>`;
    return `<div class="q"><div class="muted">From ${esc(v.from)} · ${esc(v.subject)}</div>
      ${v.code ? `<div class="row"><b style="font-size:18px;letter-spacing:.12em">${esc(v.code)}</b>${codeInput ? `<button class="main pastecode" style="margin-left:auto">Paste</button>` : ""}</div>` : ""}
      ${v.link ? `<button class="ghost openlink">Open verification link</button>` : ""}</div><button class="ghost getcode">Check again</button>`;
  }
  function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]); }

  /* ---------- Start ---------- */
  chrome.runtime.onMessage.addListener((message) => { if (message?.type === "jobguard-fill" && hasForm()) void run(); });
  const hasForm = () => [...document.querySelectorAll("input, textarea, select")].some(candidate);

  send({ type: "config" }).then(({ autoFill, connected }) => {
    if (!connected || !hasForm()) return;
    if (!autoFill) { panel.render("idle"); return; }
    void run();
    // Multi-step forms (Workday's "Next"): fill new fields as they appear, without re-asking about old ones.
    let timer;
    new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(() => { if (!running) { const fresh = [...document.querySelectorAll("input, textarea, select")].some((el) => !handled.has(el) && candidate(el)); if (fresh) void run(); } }, 1200); })
      .observe(document.body, { childList: true, subtree: true });
  }).catch(() => { /* extension reloaded; ignore */ });
})();
