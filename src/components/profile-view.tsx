"use client";

import { useRef, useState, type DragEvent, type FormEvent } from "react";
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

type TokenStatus = { createdAt: string; lastUsedAt: string | null } | null;
const fmt = (iso: string) => new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(new Date(iso));

function ExtensionCard({ initialStatus }: { initialStatus: TokenStatus }) {
  const [status, setStatus] = useState(initialStatus);
  const [token, setToken] = useState(""); const [copied, setCopied] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  async function call(method: "POST" | "DELETE") {
    if (method === "POST" && status && !confirm("Create a new token? The extension's current token will stop working until you paste the new one.")) return;
    if (method === "DELETE" && !confirm("Disconnect the extension? It stops filling forms until you connect it again.")) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/v1/extension/token", { method });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Request failed.");
      if (method === "POST") { setToken(data.token); setStatus({ createdAt: new Date().toISOString(), lastUsedAt: null }); } else { setToken(""); setStatus(null); }
    } catch (e) { setError(e instanceof Error ? e.message : "Request failed."); } finally { setBusy(false); }
  }
  async function copy(text: string, what: string) { try { await navigator.clipboard.writeText(text); setCopied(what); setTimeout(() => setCopied(""), 1500); } catch { /* user can select it manually */ } }
  return (
    <section className="panel">
      <div className="viz-card-head"><div><h2 style={{ margin: 0 }}>Browser extension</h2><p className="muted small" style={{ margin: "4px 0 0" }}>Fills job applications from this answer bank. It never clicks Submit.</p></div>
        {status ? <span className="chip src-user">Connected</span> : <span className="chip chip-status-unknown">Not connected</span>}</div>
      {status && !token && <p className="small muted">Token created {fmt(status.createdAt)} · {status.lastUsedAt ? `last used ${fmt(status.lastUsedAt)}` : "not used yet"}</p>}
      {token && (
        <div className="token-box">
          <p className="small">Paste these into the extension’s settings. <strong>The token is shown only once.</strong></p>
          <div className="token-row"><span className="muted small">JobGuard URL</span><code>{origin}</code><button className="button secondary small-button" onClick={() => void copy(origin, "url")}>{copied === "url" ? "Copied ✓" : "Copy"}</button></div>
          <div className="token-row"><span className="muted small">Token</span><code>{token}</code><button className="button secondary small-button" onClick={() => void copy(token, "token")}>{copied === "token" ? "Copied ✓" : "Copy"}</button></div>
        </div>
      )}
      <div className="actions" style={{ marginTop: 12 }}>
        <button className="button" disabled={busy} onClick={() => void call("POST")}>{status ? "Create new token" : "Connect extension"}</button>
        {status && <button className="button secondary" disabled={busy} onClick={() => void call("DELETE")}>Disconnect</button>}
      </div>
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}

export function ProfileView({ initial, aiEnabled, tokenStatus }: { initial: Profile; aiEnabled: boolean; tokenStatus: TokenStatus }) {
  const [profile, setProfile] = useState(initial);
  const [version, setVersion] = useState(0); // bumped on resume upload so every field box shows the new values
  const standard = profile.fields.filter((f) => f.group !== "Saved answers");
  const filled = standard.filter((f) => f.value).length;

  return (
    <div className="profile-root">
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
      <ExtensionCard initialStatus={tokenStatus} />
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
        ? "Your resume is stored encrypted. To read it, its contents are sent to Google Gemini; on Gemini’s free tier Google may use them to improve its models."
        : "Your resume is stored encrypted. Automatic reading is off on this server, so fill the answers yourself."}</p>
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
