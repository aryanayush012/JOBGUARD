"use client";

import { useEffect, useRef, useState, type DragEvent, type FormEvent } from "react";
import { GROUPS, type ProfileField } from "@/lib/profile-fields";

type Resume = { fileName: string; size: number; uploadedAt: string } | null;
type Profile = { fields: ProfileField[]; resume: Resume };
const SOURCE_LABEL = { RESUME: "From resume", USER: "Edited by you", AI: "AI draft" } as const;
const LONG = new Set(["summary", "skills"]);

async function send(url: string, init: RequestInit) {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Something went wrong. Please try again.");
  return data as Profile & { warning?: string };
}

type TokenStatus = { devices: number; lastUsedAt: string | null } | null;
type Settings = { autoFill: boolean; emailScan: boolean; aiAssist: boolean };
const fmt = (iso: string) => new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(new Date(iso));
const STORE_URL = process.env.NEXT_PUBLIC_EXTENSION_STORE_URL || "";

/** Talks to the JobGuard extension through its bridge script (it only runs on JobGuard's own pages). */
function askExtension(type: "status" | "connect" | "disconnect", token?: string) {
  return new Promise<{ ok: boolean; data?: { connected?: boolean; version?: string }; error?: string } | null>((resolve) => {
    const requestId = Math.random().toString(36).slice(2);
    const onMessage = (e: MessageEvent) => {
      if (e.source !== window || e.data?.source !== "jobguard-extension" || e.data.requestId !== requestId) return;
      window.removeEventListener("message", onMessage); resolve(e.data);
    };
    window.addEventListener("message", onMessage);
    window.postMessage({ source: "jobguard-page", type, token, requestId }, window.location.origin);
    setTimeout(() => { window.removeEventListener("message", onMessage); resolve(null); }, 4000);
  });
}

function ExtensionCard({ initialStatus }: { initialStatus: TokenStatus }) {
  const [status, setStatus] = useState(initialStatus);
  const [phase, setPhase] = useState<"checking" | "missing" | "connecting" | "connected" | "error">("checking");
  const [version, setVersion] = useState(""); const [error, setError] = useState("");
  const ref = useRef<HTMLElement>(null);

  // Installed + not connected → connect right away (no token to copy). That's the whole setup.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (new URLSearchParams(window.location.search).has("connect")) ref.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      for (let i = 0; i < 10 && !document.documentElement.dataset.jobguardExtension; i++) await new Promise((r) => setTimeout(r, 200));
      if (cancelled) return;
      if (!document.documentElement.dataset.jobguardExtension) { setPhase("missing"); return; }
      const state = await askExtension("status");
      setVersion(state?.data?.version || document.documentElement.dataset.jobguardExtension || "");
      if (state?.data?.connected) { setPhase("connected"); return; }
      setPhase("connecting");
      try {
        const response = await fetch("/api/v1/extension/token", { method: "POST" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Couldn't create a connection.");
        const connected = await askExtension("connect", data.token);
        if (!connected?.ok) throw new Error(connected?.error || "The extension didn't answer. Reload this page.");
        if (!cancelled) { setPhase("connected"); setStatus((s) => ({ devices: (s?.devices ?? 0) + 1, lastUsedAt: s?.lastUsedAt ?? null })); }
      } catch (e) { if (!cancelled) { setError(e instanceof Error ? e.message : "Couldn't connect."); setPhase("error"); } }
    })();
    return () => { cancelled = true; };
  }, []);

  async function disconnect() {
    if (!confirm("Disconnect the extension from your account on every browser? It stops filling forms and updating statuses until you connect again.")) return;
    await fetch("/api/v1/extension/token", { method: "DELETE" }).catch(() => {});
    await askExtension("disconnect");
    setStatus(null); setPhase(document.documentElement.dataset.jobguardExtension ? "error" : "missing"); setError("Disconnected. Reload this page to connect again.");
  }

  return (
    <section className="panel" id="extension" ref={ref}>
      <div className="viz-card-head"><div><h2 style={{ margin: 0 }}>Browser extension</h2><p className="muted small" style={{ margin: "4px 0 0" }}>Fills job applications, attaches your resume, and keeps job statuses up to date from Gmail on your own computer. It never clicks Submit.</p></div>
        {phase === "connected" ? <span className="chip src-user">Connected</span> : phase === "checking" || phase === "connecting" ? <span className="chip chip-status-unknown">{phase === "checking" ? "Checking…" : "Connecting…"}</span> : <span className="chip chip-status-unknown">Not connected</span>}</div>
      {phase === "missing" && (
        <div className="ext-install">
          {STORE_URL
            ? <a className="button" href={STORE_URL} target="_blank" rel="noreferrer">Add to Chrome</a>
            : <span className="muted small">Coming to the Chrome Web Store soon. Until then: open <code>chrome://extensions</code>, turn on Developer mode, choose <b>Load unpacked</b> and pick the JobGuard <code>extension</code> folder.</span>}
          <p className="muted small" style={{ margin: 0 }}>After installing, come back here (or it opens this page for you) and it connects automatically.</p>
        </div>
      )}
      {phase === "connected" && <p className="small muted">Version {version}{status ? ` · ${status.devices} browser${status.devices === 1 ? "" : "s"} connected` : ""}{status?.lastUsedAt ? ` · last used ${fmt(status.lastUsedAt)}` : ""}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {(phase === "connected" || status) && <div className="actions"><button className="button secondary" onClick={() => void disconnect()}>Disconnect</button></div>}
    </section>
  );
}

function PrivacyCard({ settings, aiAvailable, onChange }: { settings: Settings; aiAvailable: boolean; onChange: (s: Settings) => void }) {
  const [error, setError] = useState(""); const [saving, setSaving] = useState<keyof Settings | "">("");
  async function toggle(key: keyof Settings) {
    setSaving(key); setError("");
    try {
      const response = await fetch("/api/v1/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ [key]: !settings[key] }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Couldn't save.");
      onChange(data.settings);
    } catch (e) { setError(e instanceof Error ? e.message : "Couldn't save."); } finally { setSaving(""); }
  }
  const rows: { key: keyof Settings; title: string; body: string; disabled?: boolean }[] = [
    { key: "autoFill", title: "Fill applications automatically", body: "When you open an application on Workday, Greenhouse, Lever, Ashby or SmartRecruiters, the extension fills it from your answers. You always review and submit yourself." },
    { key: "emailScan", title: "Update job statuses from Gmail, on this computer", body: "The extension checks your Gmail inbox in your browser. Only emails about your saved jobs are sent to JobGuard, and only their sender, subject, preview line and date. Email contents never leave your computer." },
    { key: "aiAssist", title: "AI assist (Google Gemini)", disabled: !aiAvailable, body: aiAvailable
      ? "Reads your resume to fill your answers, and drafts answers to new questions. Your resume and those questions are sent to Google Gemini; on its free tier Google may use them to improve its models. Off by default."
      : "Not available on this server yet." }
  ];
  return (
    <section className="panel">
      <h2 style={{ margin: "0 0 4px" }}>Privacy &amp; automation</h2>
      <p className="muted small" style={{ margin: "0 0 8px" }}>You decide what JobGuard does. Changes apply immediately, including in the extension.</p>
      {rows.map((r) => (
        <label key={r.key} className={`toggle-row${r.disabled ? " is-disabled" : ""}`}>
          <input type="checkbox" role="switch" checked={settings[r.key]} disabled={r.disabled || saving === r.key} onChange={() => void toggle(r.key)} />
          <span><b>{r.title}</b><span className="muted small">{r.body}</span></span>
        </label>
      ))}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}

function DangerZone() {
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function remove() {
    if (window.prompt("This permanently deletes your account, jobs, resume, answers and email history, and revokes Gmail access. Type DELETE to confirm.") !== "DELETE") return;
    setBusy(true);
    try {
      const response = await fetch("/api/v1/account", { method: "DELETE" });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || "Couldn't delete.");
      void askExtension("disconnect");
      window.location.href = "/";
    } catch (e) { setError(e instanceof Error ? e.message : "Couldn't delete."); setBusy(false); }
  }
  return (
    <section className="panel danger-zone">
      <h2 style={{ margin: "0 0 4px" }}>Delete my data</h2>
      <p className="muted small">Removes your account and everything JobGuard stores for you. This can&apos;t be undone.</p>
      <button className="button secondary danger-button" disabled={busy} onClick={() => void remove()}>{busy ? "Deleting…" : "Delete my account and data"}</button>
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}

export function ProfileView({ initial, aiAvailable, initialSettings, tokenStatus }: { initial: Profile; aiAvailable: boolean; initialSettings: Settings; tokenStatus: TokenStatus }) {
  const [settings, setSettings] = useState(initialSettings);
  const aiEnabled = aiAvailable && settings.aiAssist;
  const [profile, setProfile] = useState(initial);
  const [version, setVersion] = useState(0); // bumped on resume upload so every field box shows the new values
  const standard = profile.fields.filter((f) => f.group !== "Saved answers");
  const filled = standard.filter((f) => f.value).length;

  return (
    <div className="profile-root">
      <PrivacyCard settings={settings} aiAvailable={aiAvailable} onChange={setSettings} />
      <ExtensionCard initialStatus={tokenStatus} />
      <ResumeCard resume={profile.resume} aiEnabled={aiEnabled} onUploaded={(p) => { setProfile(p); setVersion((v) => v + 1); }} />
      <section className="panel completeness" aria-label="Profile completeness">
        <div><strong>{filled} of {standard.length}</strong> <span className="muted">standard answers filled</span></div>
        <div className="meter" role="meter" aria-valuemin={0} aria-valuemax={standard.length} aria-valuenow={filled}><span style={{ width: `${(filled / standard.length) * 100}%` }} /></div>
        <p className="muted small">The extension fills forms from these answers. Edit anything, any time: your edits are used on the next form and a new resume never overwrites them.</p>
      </section>
      {GROUPS.filter((g) => g !== "Saved answers").map((group) => (
        <section key={group} className="panel field-group">
          <h2>{group}</h2>
          <div className="field-grid">{profile.fields.filter((f) => f.group === group).map((f) => <FieldRow key={`${f.key}:${version}`} field={f} onSaved={setProfile} />)}</div>
        </section>
      ))}
      <SavedAnswers fields={profile.fields.filter((f) => f.group === "Saved answers")} onSaved={setProfile} />
      <DangerZone />
    </div>
  );
}

function ResumeCard({ resume, aiEnabled, onUploaded }: { resume: Resume; aiEnabled: boolean; onUploaded: (p: Profile) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false); const [drag, setDrag] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  async function upload(file: File | undefined) {
    if (!file) return;
    if (file.type && file.type !== "application/pdf") { setMessage({ kind: "error", text: "Resume must be a PDF." }); return; }
    if (file.size > 4 * 1024 * 1024) { setMessage({ kind: "error", text: "Resume must be 4 MB or smaller." }); return; }
    setBusy(true); setMessage(null);
    try {
      const body = new FormData(); body.append("resume", file);
      const data = await send("/api/v1/profile/resume", { method: "POST", body });
      onUploaded(data);
      setMessage(data.warning ? { kind: "error", text: data.warning } : { kind: "success", text: "Resume read. Check the answers below and fill anything marked “Needs your input”." });
    } catch (error) { setMessage({ kind: "error", text: error instanceof Error ? error.message : "Upload failed." }); }
    finally { setBusy(false); if (input.current) input.current.value = ""; }
  }
  const onDrop = (e: DragEvent) => { e.preventDefault(); setDrag(false); void upload(e.dataTransfer.files[0]); };

  return (
    <section className="panel">
      <div className="viz-card-head"><div><h2 style={{ margin: 0 }}>Resume</h2><p className="muted small" style={{ margin: "4px 0 0" }}>Upload a PDF and your answers below fill themselves in.</p></div>
        {resume && <a className="button secondary small-button" href="/api/v1/profile/resume" target="_blank" rel="noreferrer">View current</a>}</div>
      <div className={`dropzone${drag ? " is-drag" : ""}${busy ? " is-busy" : ""}`} role="button" tabIndex={0} aria-busy={busy}
        onClick={() => !busy && input.current?.click()} onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && !busy) { e.preventDefault(); input.current?.click(); } }}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={onDrop}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></svg>
        {busy ? <><strong>Reading your resume…</strong><span className="muted small">{aiEnabled ? "This takes 10–30 seconds." : "Saving…"}</span></>
          : resume ? <><strong>{resume.fileName}</strong><span className="muted small">{(resume.size / 1024).toFixed(0)} KB · uploaded {new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" }).format(new Date(resume.uploadedAt))} · drop a new PDF to replace it</span></>
          : <><strong>Drop your resume here, or click to choose</strong><span className="muted small">PDF, up to 4 MB</span></>}
        <input ref={input} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => void upload(e.target.files?.[0])} />
      </div>
      {message && <p className={message.kind} role={message.kind === "error" ? "alert" : "status"}>{message.text}</p>}
      <p className="muted small" style={{ marginBottom: 0 }}>{aiEnabled
        ? "Your resume is stored encrypted. With AI assist on, it is sent to Google Gemini to read it; on Gemini’s free tier Google may use it to improve its models."
        : "Your resume is stored encrypted and is not sent anywhere. Turn on AI assist above to have it read automatically, or fill the answers yourself."}</p>
    </section>
  );
}

function FieldRow({ field, onSaved }: { field: ProfileField; onSaved: (p: Profile) => void }) {
  const [value, setValue] = useState(field.value);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState("");
  const id = `field-${field.key}`;
  async function save() {
    if (value.trim() === field.value) return;
    setState("saving");
    try { onSaved(await send("/api/v1/profile/fields", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: field.key, label: field.label, value }) })); setState("saved"); }
    catch (e) { setError(e instanceof Error ? e.message : "Save failed."); setState("error"); }
  }
  const needsInput = !field.fromResume && !field.value;
  return (
    <div className={`field-row${LONG.has(field.key) ? " field-wide" : ""}`}>
      <div className="field-row-head">
        <label htmlFor={id}>{field.label}</label>
        {needsInput ? <span className="chip chip-missed">Needs your input</span> : field.value && <span className={`chip src-${field.source.toLowerCase()}`}>{SOURCE_LABEL[field.source]}</span>}
        <span className="save-state" role="status">{state === "saving" ? "Saving…" : state === "saved" ? "Saved ✓" : ""}</span>
      </div>
      {LONG.has(field.key)
        ? <textarea id={id} rows={3} value={value} maxLength={5000} onChange={(e) => { setValue(e.target.value); setState("idle"); }} onBlur={save} />
        : <input id={id} value={value} maxLength={5000} onChange={(e) => { setValue(e.target.value); setState("idle"); }} onBlur={save} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />}
      {state === "error" && <span className="error small" role="alert">{error}</span>}
    </div>
  );
}

function SavedAnswers({ fields, onSaved }: { fields: ProfileField[]; onSaved: (p: Profile) => void }) {
  const [label, setLabel] = useState(""); const [value, setValue] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  async function add(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    try { onSaved(await send("/api/v1/profile/fields", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ label, value }) })); setLabel(""); setValue(""); }
    catch (err) { setError(err instanceof Error ? err.message : "Save failed."); } finally { setBusy(false); }
  }
  async function remove(key: string) {
    if (!confirm("Delete this saved answer?")) return;
    try { onSaved(await send(`/api/v1/profile/fields?key=${encodeURIComponent(key)}`, { method: "DELETE" })); } catch (err) { setError(err instanceof Error ? err.message : "Delete failed."); }
  }
  return (
    <section className="panel field-group">
      <h2>Saved answers</h2>
      <p className="muted small">Answers to other questions forms ask. The extension adds these when you approve a new answer, and you can add your own. Questions about a specific company (“Why do you want to join…?”) are marked <span className="chip src-ai">Per company</span> and are never reused for a different company.</p>
      {fields.map((f) => (
        <div key={f.key} className="saved-answer">
          <FieldRow field={f} onSaved={onSaved} />
          <div className="saved-answer-meta">{!f.reusable && <span className="chip src-ai">Per company</span>}<button className="link-button delete-link" onClick={() => void remove(f.key)}>Delete</button></div>
        </div>
      ))}
      <form className="add-answer" onSubmit={add}>
        <div className="field"><label htmlFor="new-q">Question</label><input id="new-q" required maxLength={300} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Years of React experience" /></div>
        <div className="field"><label htmlFor="new-a">Answer</label><input id="new-a" maxLength={5000} value={value} onChange={(e) => setValue(e.target.value)} placeholder="e.g. 3" /></div>
        <button className="button" disabled={busy}>{busy ? "Saving…" : "Add answer"}</button>
      </form>
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}
