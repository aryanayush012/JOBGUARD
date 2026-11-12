// JobGuard Autofill: fills application forms from your answer bank. It never clicks Submit.
(() => {
  if (window.__jobguard) return;
  window.__jobguard = true;

  // After the extension is updated or reloaded, scripts already running in open tabs are cut off from it
  // ("Extension context invalidated"). Check first, and never let that surface as an error.
  const alive = () => { try { return Boolean(chrome.runtime?.id); } catch { return false; } };
  const send = (message) => new Promise((resolve, reject) => {
    if (!alive()) return reject(new Error("JobGuard was just updated: reload this page to use it."));
    try {
      chrome.runtime.sendMessage(message, (reply) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (reply?.ok) resolve(reply.data); else reject(new Error(reply?.error || "Extension error."));
      });
    } catch (e) { reject(new Error(alive() ? e.message : "JobGuard was just updated: reload this page to use it.")); }
  });
  const api = (path, method, body) => send({ type: "api", path, method, body });

  /* ---------- Finding questions ---------- */
  const text = (el) => (el?.innerText || el?.textContent || "").replace(/\s+/g, " ").trim();
  const clean = (label) => label.replace(/\*/g, " ").replace(/\((required|optional)\)/gi, " ").replace(/\s+/g, " ").trim().slice(0, 300);
  const isVisible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };

  // A real question has words in it: not an internal id ("rec-form_2088…"), a currency sign or a placeholder word.
  const readable = (s) => Boolean(s) && /[a-z]{2,}/i.test(s) && !/^[\w-]*\d{5,}[\w-]*$/.test(s.trim()) && !/^(value|text|input|field|select|none)$/i.test(s.trim());
  // Attribute values like "manual_First_Name" or "personalInfo.firstName" → "First Name".
  // Repeating rows end in indexes ("Company_0_2"): the first row is your current one, so its index is dropped;
  // later rows become "Company (entry 2)" so they're never filled with your current company.
  const humanize = (s) => {
    let t = s.replace(/^(manual|rec|field|input|form|cx|lt)[_-]+/i, "");
    let entry = "";
    const indexes = /(?:[_\s.-]+\d+)+$/.exec(t);
    if (indexes) { const first = Number(indexes[0].match(/\d+/)[0]); if (first > 0) entry = ` (entry ${first + 1})`; t = t.slice(0, indexes.index); }
    return (t.replace(/[_-]+s$/i, "").replace(/[._-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/\$/g, "").trim() + entry).trim();
  };
  const LABEL_ATTRS = ["aria-label", "cx-prop-label", "lt-prop-label", "data-label", "label", "data-automation-id", "data-zcqa", "cx-prop-zcqa", "data-qa", "data-testid"];
  const CONTROLS = "input:not([type=hidden]), select, textarea";

  function labelFor(el) {
    if (el.id) { const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (readable(text(l))) return text(l); }
    const ids = el.getAttribute("aria-labelledby");
    if (ids) { const t = ids.split(/\s+/).map((id) => text(document.getElementById(id))).join(" ").trim(); if (readable(t)) return t; }
    if (readable(el.getAttribute("aria-label"))) return el.getAttribute("aria-label");
    const wrap = el.closest("label"); if (readable(text(wrap))) return text(wrap);
    const legend = el.closest("fieldset")?.querySelector("legend"); if (readable(text(legend))) return text(legend);
    // Component libraries (Zoho, Workday…) keep the label in attributes or a sibling element. Only look inside wrappers
    // that hold this one field, so a neighbouring question's label is never picked up.
    let parent = el.parentElement;
    for (let i = 0; i < 12 && parent && parent !== document.body; i++, parent = parent.parentElement) {
      if ([...parent.querySelectorAll(CONTROLS)].some((c) => c !== el && c.type !== "file" && isVisible(c))) break;
      for (const name of LABEL_ATTRS) { const v = parent.getAttribute(name); if (v && readable(humanize(v))) return humanize(v); }
      const l = parent.querySelector("label, legend, [data-automation-id*='formLabel'], [class*='label' i]");
      if (l && !l.contains(el) && readable(text(l)) && text(l).length < 300) return text(l);
    }
    const fallback = el.getAttribute("placeholder") || humanize(el.name || "");
    return readable(fallback) ? fallback : ""; // nothing readable: skip the field rather than send an id
  }

  let handled = new WeakSet(); // elements already processed, so new form steps don't re-ask the server
  let counter = 0;
  const SKIP_TYPES = ["hidden", "submit", "button", "reset", "image", "checkbox", "password"];
  // A field worth looking at: visible, editable, and a kind we fill (password fields are never touched).
  // File inputs are usually hidden behind a styled "Upload" button, so they count even when invisible.
  const candidate = (el) => !el.disabled && !el.readOnly && (isVisible(el) || el.type === "file") && !SKIP_TYPES.includes((el.getAttribute("type") || "").toLowerCase());

  const CODE_LABEL = /verification code|one[- ]time|\botp\b|passcode|security code|enter (the )?code|confirmation code/i;
  const CAPTCHA = /captcha|image text|text (in|from|shown in) the image|not a robot|security check/i; // never filled, never sent anywhere
  let codeInput = null; // a "verification code" box: filled from Gmail on request, never sent to the AI

  /* ---------- Custom dropdowns (built from page elements, not a real <select>) ---------- */
  // Zoho's lyte-dropdown and the accessible pattern Workday and others use: a button that opens a list of options.
  const CUSTOM_DROPDOWN = "lyte-dropdown, button[aria-haspopup=listbox], [role=combobox]:not(input):not(select):not(textarea), [aria-haspopup=listbox]:not(input):not(button)";
  const OPTION = "[role=option], lyte-drop-item";
  const PLACEHOLDER = /^(-+\s*none\s*-+|none|select\b.*|choose\b.*|please select.*|--+|)$/i;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const press = (el) => { for (const t of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window })); };
  const openOptions = () => [...document.querySelectorAll(OPTION)].filter(isVisible);
  const optionText = (o) => text(o) || o.getAttribute("data-value") || "";
  async function openDropdown(target) {
    press(target.button);
    for (let i = 0; i < 12; i++) { await sleep(100); const options = openOptions(); if (options.length) return options; }
    return [];
  }
  async function closeDropdown(target) {
    if (!openOptions().length) return;
    (document.activeElement || document.body).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
    await sleep(150);
    if (openOptions().length) { press(target.button); await sleep(150); }
  }
  // Reads a custom dropdown's choices by opening it briefly, so answers can be matched to the real options.
  async function readDropdown(target) {
    const options = (await openDropdown(target)).map(optionText).filter((o) => o && !PLACEHOLDER.test(o));
    await closeDropdown(target);
    return [...new Set(options)].slice(0, 200);
  }
  async function fillDropdown(target, value) {
    const option = (await openDropdown(target)).find((o) => optionText(o) === value);
    if (!option) { await closeDropdown(target); return null; }
    press(option); await sleep(200);
    await closeDropdown(target);
    mark(target.el, "BANK");
    return target.el;
  }

  async function collect() {
    const questions = []; const targets = new Map(); const resumeInputs = []; let photoInput = null;
    const add = (label, target, options) => {
      label = clean(label); if (!label) return;
      const id = `q${counter++}`; questions.push({ id, label, ...(options ? { options } : {}) }); targets.set(id, target);
    };
    for (const el of document.querySelectorAll("input, textarea, select")) {
      if (handled.has(el) || !candidate(el)) continue;
      const type = (el.getAttribute("type") || "text").toLowerCase();
      if (el.tagName === "INPUT" && type === "file") {
        handled.add(el);
        const hint = `${labelFor(el)} ${el.name} ${el.id}`.toLowerCase();
        if (/resume|\bcv\b|curriculum/.test(hint) && !/cover|photo|picture/.test(hint) && !el.files?.length) resumeInputs.push({ el, easy: /easy|parse|autofill/.test(hint) });
        else if (!photoInput && /photo|picture|headshot|avatar|profile image/.test(hint) && !el.files?.length) photoInput = el;
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
      const label = labelFor(el);
      if (CAPTCHA.test(`${label} ${el.name} ${el.getAttribute("placeholder") || ""}`)) continue;
      if (el.tagName === "INPUT" && CODE_LABEL.test(`${label} ${el.name} ${el.id} ${el.autocomplete}`)) { codeInput = el; continue; }
      if ((el.tagName === "TEXTAREA" || ["text", "email", "tel", "url", "number", "search"].includes(type)) && !el.value) add(label, { kind: "text", el }); // never overwrite what you typed
    }
    // Custom dropdowns: only ones with a readable label and no choice made yet. Ones that wrap a typing box
    // (autocompletes like Zoho's City) were already handled above as text fields.
    for (const el of document.querySelectorAll(CUSTOM_DROPDOWN)) {
      if (handled.has(el) || !isVisible(el) || el.closest("[data-jobguard-dropdown]")) continue;
      handled.add(el);
      if ([...el.querySelectorAll("input:not([type=hidden]), textarea")].some((i) => isVisible(i) && !i.readOnly)) continue;
      const current = text(el).replace(/[▾▼⌄]/g, "").trim();
      if (current && !PLACEHOLDER.test(current)) continue; // you (or the site) already chose something
      const label = labelFor(el);
      if (!readable(label) || CAPTCHA.test(label)) continue;
      el.dataset.jobguardDropdown = "1";
      const target = { kind: "dropdown", el, button: el.querySelector("lyte-drop-button") || el };
      const options = await readDropdown(target);
      if (options.length) add(label, target, options);
    }
    // Prefer the site's real "Resume" upload over a "parse my resume" shortcut (that one can overwrite fields we filled).
    const resumeInput = (resumeInputs.find((r) => !r.easy) || resumeInputs[0])?.el || null;
    return { questions, targets, resumeInput, photoInput };
  }

  /* ---------- Filling ---------- */
  function setValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value); // native setter, so React-built forms notice
    for (const type of ["input", "change", "blur"]) el.dispatchEvent(new Event(type, { bubbles: true }));
  }
  // Outline colours: amber = from your answers, purple = AI draft, green = typed by you in the panel.
  function mark(el, source) { el.style.outline = `2px solid ${source === "AI" ? "#a78bfa" : source === "YOU" ? "#4ade80" : "#fab81a"}`; el.style.outlineOffset = "2px"; el.dataset.jobguard = source; }

  // Async because custom dropdowns have to be opened and clicked.
  async function fill(target, value, source) {
    if (target.kind === "dropdown") { const el = await fillDropdown(target, value); if (el) mark(el, source); return el; }
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

  // Puts your resume or photo into an upload field (the same as choosing the file yourself).
  async function attachFile(input, path, fallbackType) {
    const { base64, fileName, type } = await api(path);
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], fileName, { type: type || fallbackType }));
    input.files = transfer.files;
    for (const t of ["input", "change"]) input.dispatchEvent(new Event(t, { bubbles: true }));
    mark(input, "BANK");
  }

  /* ---------- One pass over the page ---------- */
  // items: every question on the form, with its answer (from your answers, an AI draft, or still needed from you).
  const state = { items: [], skipped: 0, resume: "", photo: "", job: null, error: "", verification: null, applied: "", saving: false, savedMsg: "", ran: false, aiRetry: "" };

  // Google's free AI is sometimes busy. Then ask again by itself once (after 45s), or right away with "Try AI again";
  // only questions that are still empty are sent.
  let retryTimer = null; let autoRetried = false;
  function scheduleAiRetry() {
    if (autoRetried || retryTimer) return;
    autoRetried = true; state.aiRetry = "Retrying automatically in 45 seconds…";
    retryTimer = setTimeout(() => { retryTimer = null; void retryAi(); }, 45_000);
  }
  async function retryAi() {
    clearTimeout(retryTimer); retryTimer = null;
    const pending = state.items.filter((i) => i.source === "YOU" && !currentValue(i.target));
    if (!pending.length) { state.aiRetry = ""; state.error = ""; panel.render("done"); return; }
    state.aiRetry = "Asking AI again…"; state.error = ""; panel.render("done");
    try {
      const result = await api("/api/ext/fill", "POST", { url: location.href, questions: pending.map((i) => ({ id: String(state.items.indexOf(i)), label: i.label, ...(i.options?.length ? { options: i.options } : {}) })) });
      if (result.aiError) state.error = result.aiError;
      for (const answer of result.answers) {
        const item = state.items[Number(answer.id)];
        if (!item || currentValue(item.target)) continue; // you typed something meanwhile: keep yours
        if (await fill(item.target, answer.value, answer.source)) Object.assign(item, { value: answer.value, source: answer.source, save: answer.source === "AI" && !item.perCompany });
      }
    } catch (e) { state.error = e.message; }
    state.aiRetry = ""; panel.render("done");
  }
  const PER_COMPANY = /why (do you want|are you interested|join|this (role|company|position|team)|us\b)|what (excites|interests|attracts) you/i;
  // "Why this company?" answers are never reused (JobGuard keeps them per company), so they're never offered for saving.
  const perCompany = (label) => PER_COMPANY.test(label) || Boolean(state.job?.company && label.toLowerCase().includes(state.job.company.toLowerCase()));

  // Account sign-up on application sites: fetch the code/link the site just emailed you (read from your Gmail).
  async function getVerification() {
    state.verification = { loading: true }; panel.render("done");
    try {
      // Looked up in this browser first (code never leaves your computer); the server is only asked if you use the Gmail beta.
      state.verification = await send({ type: "verification", host: location.hostname })
        || await api(`/api/ext/verification?host=${encodeURIComponent(location.hostname)}`).catch(() => null)
        || { error: "No verification email from the last 20 minutes yet. Open Gmail in this browser or wait a moment, then try again." };
    } catch (e) { state.verification = { error: e.message }; }
    panel.render("done");
  }

  // Marks the saved job Applied only when BOTH happen: you clicked a Submit/Apply button, and within 2 minutes a
  // confirmation ("Thank you for applying…") appears that wasn't on the page before. Text that's simply part of a
  // form or a job description never counts. The click is remembered for the page you land on after submitting.
  const SUBMITTED = /application (has been |was )?(submitted|received)|thank you for (applying|your application|submitting)|we('ve| have) received your application|you('ve| have) (successfully )?applied|successfully (applied|submitted)/i;
  const SUBMIT_KEY = "jobguard-submit-click";
  const confirmationsIn = (s) => (s.match(new RegExp(SUBMITTED.source, "gi")) || []).length;
  let textBeforeSubmit = null;
  function noteSubmitClick(event) {
    const el = event.type === "submit" ? event.target : event.target?.closest?.("button, input[type=submit], input[type=button], a, [role=button]");
    const label = event.type === "submit" ? "submit" : (el?.innerText || el?.value || el?.getAttribute?.("aria-label") || "").trim();
    if (!/^(submit|apply|send|finish|complete)/i.test(label) || /save|draft|next|back|cancel|linkedin|indeed/i.test(label)) return;
    textBeforeSubmit = document.body?.innerText || "";
    try { sessionStorage.setItem(SUBMIT_KEY, String(Date.now())); } catch { /* storage blocked */ }
  }
  const safeNote = (event) => { try { noteSubmitClick(event); } catch { /* never break the page's own buttons */ } };
  document.addEventListener("click", safeNote, true);
  document.addEventListener("submit", safeNote, true);
  let appliedSent = false;
  async function checkSubmitted() {
    if (appliedSent) return;
    let clickedAt = 0; try { clickedAt = Number(sessionStorage.getItem(SUBMIT_KEY)) || 0; } catch { /* storage blocked */ }
    if (!clickedAt || Date.now() - clickedAt > 120_000) return;
    const now = document.body?.innerText || "";
    // Same page: the confirmation must be new. New page (after navigation): any confirmation counts.
    if (textBeforeSubmit !== null ? confirmationsIn(now) <= confirmationsIn(textBeforeSubmit) : !SUBMITTED.test(now)) return;
    appliedSent = true;
    try { sessionStorage.removeItem(SUBMIT_KEY); } catch { /* storage blocked */ }
    try {
      const result = await api("/api/ext/applied", "POST", { url: location.href });
      if (result.matched) { state.applied = `${result.title || "Job"} at ${result.company} marked as applied in JobGuard ✓`; panel.render("done"); }
    } catch { appliedSent = false; }
  }
  let running = false;

  async function run() {
    if (running) return; running = true; state.ran = true; panel.render("working");
    try {
      const { questions, targets, resumeInput, photoInput } = await collect();
      if (resumeInput) {
        try { await attachFile(resumeInput, "/api/ext/resume", "application/pdf"); state.resume = "attached"; } catch (e) { state.resume = e.message; }
      }
      if (photoInput) {
        try { await attachFile(photoInput, "/api/ext/photo", "image/jpeg"); state.photo = "attached"; } catch (e) { state.photo = e.message; }
      }
      if (questions.length) {
        const result = await api("/api/ext/fill", "POST", { url: location.href, questions });
        state.job = result.job || state.job;
        if (result.aiError) state.error = result.aiError;
        const answers = new Map(result.answers.map((a) => [a.id, a]));
        const skipped = new Set(result.skipped);
        // Every question ends up in the panel: filled from your answers, an AI draft, or "needs your answer".
        for (const q of questions) {
          if (skipped.has(q.id)) { state.skipped++; continue; }
          const target = targets.get(q.id); const answer = answers.get(q.id);
          const filled = answer && await fill(target, answer.value, answer.source);
          const company = perCompany(q.label);
          state.items.push({ label: q.label, target, options: q.options, value: filled ? answer.value : "", source: filled ? answer.source : "YOU", save: filled ? answer.source === "AI" && !company : !company, perCompany: company });
        }
        if (result.aiError && state.items.some((i) => i.source === "YOU")) scheduleAiRetry();
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
      .card{font:13px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;color:#f5f6f7;background:#17191d;border:1px solid #2b2f36;border-radius:16px;box-shadow:0 18px 50px rgba(0,0,0,.5);width:350px;max-height:75vh;display:flex;flex-direction:column}
      .sec{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#a7adb7;margin-top:4px;display:flex;align-items:center;gap:6px}
      .ql{color:#d5d8dd}.ql small{color:#a7adb7}
      .q input:not([type=checkbox]),.q select,.q textarea{width:100%;box-sizing:border-box;background:#0f1012;color:#f5f6f7;border:1px solid #2b2f36;border-radius:8px;padding:7px 9px;font:inherit;resize:vertical}
      .q input:focus,.q select:focus,.q textarea:focus{outline:none;border-color:#fab81a}
      .sv{display:flex;gap:6px;align-items:center;color:#a7adb7;font-size:12px}
      details summary{cursor:pointer;color:#a7adb7}details[open] summary{margin-bottom:8px}details .q{margin-top:6px}
      .ok{color:#9ce3b1}
      .head{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid #2b2f36}.brand{font-weight:800;letter-spacing:-.03em}.brand span{color:#fab81a}
      .x{margin-left:auto;background:none;border:0;color:#a7adb7;font-size:18px;cursor:pointer}
      .body{padding:12px 14px;overflow:auto;display:grid;gap:10px}.muted{color:#a7adb7}.err{color:#ff8b8b}
      .row{display:flex;gap:8px;align-items:center}.dot{width:10px;height:10px;border-radius:3px;flex:none}
      .q{border:1px solid #2b2f36;border-radius:10px;padding:8px;display:grid;gap:6px}.q label{display:flex;gap:6px;align-items:flex-start;color:#a7adb7}
      button.main{background:#fab81a;color:#17130a;border:0;border-radius:10px;padding:10px 12px;font-weight:700;cursor:pointer}
      button.ghost{background:none;color:#f5f6f7;border:1px solid #2b2f36;border-radius:10px;padding:8px 12px;cursor:pointer}
      .pill{background:#fab81a;color:#17130a;border:0;border-radius:999px;padding:10px 14px;font:700 13px system-ui;cursor:pointer;box-shadow:0 10px 30px rgba(0,0,0,.45)}`;
    function render(phase) {
      if (!document.body) return; // frames without a page body (e.g. empty embeds) get no panel
      if (!document.body.contains(host)) document.body.appendChild(host);
      const need = state.items.filter((i) => i.source === "YOU"), drafts = state.items.filter((i) => i.source === "AI"), bank = state.items.filter((i) => i.source === "BANK");
      if (!open) { root.innerHTML = `<style>${css}</style><button class="pill">JobGuard${need.length + drafts.length ? ` · ${need.length + drafts.length} to review` : ""}</button>`; root.querySelector(".pill").onclick = () => { open = true; render(phase); }; return; }
      const job = state.job ? `<div class="muted">${esc(state.job.title || "Role")} · ${esc(state.job.company)}</div>` : "";
      // One editable row per question; typing here fills the form as you type.
      const row = (item, long) => {
        const i = state.items.indexOf(item);
        const control = item.options?.length
          ? `<select data-v="${i}"><option value="">—</option>${item.options.map((o) => `<option ${o === item.value ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>`
          : long ? `<textarea rows="3" data-v="${i}">${esc(item.value)}</textarea>` : `<input data-v="${i}" value="${esc(item.value)}">`;
        const save = item.perCompany ? `<span class="sv">Only for this company: not saved</span>` : `<label class="sv"><input type="checkbox" data-save="${i}" ${item.save ? "checked" : ""}> Save to my answers</label>`;
        return `<div class="q"><div class="ql">${esc(item.label)}</div>${control}${save}</div>`;
      };
      // Only new questions are editable here; answers that came from your profile are managed on the Profile page.
      const anySave = state.items.some((i) => i.source !== "BANK" && !i.perCompany);
      const body = phase === "idle" ? `<div class="muted">Fill this application from your JobGuard answers. You review and submit.</div><button class="main">Fill this application</button>`
        : phase === "working" ? `<div class="muted">Filling… AI drafts can take up to 30 seconds.</div>`
        : `${job}
          ${state.applied ? `<div class="row ok">${esc(state.applied)}</div>` : ""}
          ${state.ran ? `<div class="row"><span class="dot" style="background:#fab81a"></span>${bank.length} filled from your profile${drafts.length ? ` · ${drafts.length} AI draft${drafts.length === 1 ? "" : "s"}` : ""}${need.length ? ` · ${need.length} new for you` : ""}</div>` : ""}
          ${state.resume === "attached" ? `<div class="row"><span class="dot" style="background:#fab81a"></span>Resume attached</div>` : state.resume ? `<div class="err">Resume: ${esc(state.resume)}</div>` : ""}
          ${state.photo === "attached" ? `<div class="row"><span class="dot" style="background:#fab81a"></span>Photo attached</div>` : state.photo ? `<div class="muted">Photo: ${esc(state.photo)}</div>` : ""}
          ${state.skipped ? `<div class="muted">${state.skipped} personal question${state.skipped === 1 ? "" : "s"} (gender, disability…) left for you in the form</div>` : ""}
          ${state.error ? `<div class="err">${esc(state.error)}</div>` : ""}
          ${state.aiRetry ? `<div class="muted">${esc(state.aiRetry)}</div>` : ""}
          ${state.error && need.length && state.aiRetry !== "Asking AI again…" ? `<button class="ghost retryai">Try AI again now</button>` : ""}
          ${need.length ? `<div class="sec">Needs your answer (${need.length})</div>${need.map((i) => row(i, false)).join("")}` : ""}
          ${drafts.length ? `<div class="sec"><span class="dot" style="background:#a78bfa"></span>AI drafts, check these (${drafts.length})</div>${drafts.map((i) => row(i, true)).join("")}` : ""}
          ${bank.length && !need.length && !drafts.length ? `<div class="muted">Everything here came from your profile. Change those answers on your JobGuard Profile page.</div>` : ""}
          ${anySave || state.saving || state.savedMsg ? `<button class="main save" ${state.saving ? "disabled" : ""}>${state.saving ? "Saving…" : "Save checked to my answers"}</button>` : ""}
          ${state.savedMsg ? `<div class="${state.savedMsg.startsWith("Saved") ? "ok" : "err"}">${esc(state.savedMsg)}</div>` : ""}
          ${state.ran ? `<div class="muted">Review everything, then submit the form yourself.</div>` : ""}
          ${verificationHtml()}
          ${state.ran ? `<button class="ghost again">Fill again</button>` : ""}`;
      root.innerHTML = `<style>${css}</style><div class="card" role="dialog" aria-label="JobGuard Autofill"><div class="head"><svg width="18" height="18" viewBox="0 0 128 128" aria-hidden="true"><path d="M64 10 L108 25 V60 C108 89 89 108 64 118 C39 108 20 89 20 60 V25 Z" fill="#fab81a"/><path d="M42 63 L57 78 L87 47" fill="none" stroke="#0f1012" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/></svg><div class="brand">JOB<span>GUARD</span></div><button class="x" aria-label="Minimise">–</button></div><div class="body">${body}</div></div>`;
      root.querySelector(".x").onclick = () => { open = false; render(phase); };
      root.querySelector("button.main:not(.save)")?.addEventListener("click", () => void run());
      root.querySelector(".getcode")?.addEventListener("click", () => void getVerification());
      root.querySelector(".retryai")?.addEventListener("click", () => void retryAi());
      root.querySelector(".pastecode")?.addEventListener("click", () => {
        if (codeInput && state.verification?.code) { setValue(codeInput, state.verification.code); mark(codeInput, "BANK"); }
      });
      root.querySelector(".openlink")?.addEventListener("click", () => { if (/^https:\/\//.test(state.verification?.link || "")) window.open(state.verification.link, "_blank", "noopener"); });
      root.querySelector(".again")?.addEventListener("click", () => {
        // Start over: look at every field again (filled ones are still skipped, so nothing you typed is overwritten).
        handled = new WeakSet(); Object.assign(state, { items: [], skipped: 0, resume: "", photo: "", error: "", savedMsg: "" });
        void run();
      });
      // Editing in the panel fills the form immediately; changing an answer ticks "Save" (unless it's per-company).
      root.querySelectorAll("[data-v]").forEach((control) => control.addEventListener("input", () => {
        const item = state.items[control.dataset.v]; item.value = control.value;
        if (item.value) void fill(item.target, item.value, "YOU");
        if (!item.perCompany) { item.save = true; const box = root.querySelector(`[data-save="${control.dataset.v}"]`); if (box) box.checked = true; }
      })); // no re-render here, so the cursor stays where you're typing
      root.querySelectorAll("[data-save]").forEach((box) => box.addEventListener("change", () => { state.items[box.dataset.save].save = box.checked; }));
      root.querySelector(".save")?.addEventListener("click", () => void saveAnswers());
    }
    return { render };
  })();

  // Saves ticked answers to your JobGuard answer bank. The same question in other words (e.g. "Company") updates
  // the existing field (Current company) instead of adding a duplicate; JobGuard handles that matching.
  async function saveAnswers() {
    const picked = state.items.filter((i) => i.save && !i.perCompany && (currentValue(i.target) || i.value).trim());
    if (!picked.length) { state.savedMsg = "Tick at least one answer that has a value."; panel.render("done"); return; }
    state.saving = true; state.savedMsg = ""; panel.render("done");
    try {
      const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("JobGuard didn't respond. Try again.")), 20000));
      const { saved } = await Promise.race([api("/api/ext/answers", "POST", { company: state.job?.company, answers: picked.map((i) => ({ label: i.label, value: (currentValue(i.target) || i.value).trim() })) }), timeout]);
      picked.forEach((i) => { i.save = false; });
      state.savedMsg = saved ? `Saved ${saved} answer${saved === 1 ? "" : "s"} ✓ They'll fill automatically next time.` : "Saved ✓ (already in your answers)";
    } catch (err) { state.savedMsg = err.message; }
    state.saving = false; panel.render("done");
  }

  function currentValue(target) {
    if (target.kind === "dropdown") { const shown = text(target.el).replace(/[▾▼⌄]/g, "").trim(); return PLACEHOLDER.test(shown) ? "" : shown; }
    if (target.kind === "text") return target.el.value.trim();
    if (target.kind === "select") return target.el.selectedIndex > 0 ? target.el.options[target.el.selectedIndex]?.text.trim() || "" : "";
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
    if (!connected || !document.body) return;
    void checkSubmitted();
    let timer;
    // Watch for new form steps (Workday's "Next") and for the "application submitted" screen.
    const observer = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!alive()) { observer.disconnect(); return; } // extension updated: this old copy goes quiet
        void checkSubmitted();
        if (!autoFill || running) return;
        const fresh = [...document.querySelectorAll("input, textarea, select")].some((el) => !handled.has(el) && candidate(el));
        if (fresh) void run();
      }, 1200);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    if (!hasForm()) return;
    if (autoFill) void run(); else panel.render("idle");
  }).catch(() => { /* extension reloaded; ignore */ });
})();
