"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

type ReferralEvent = { id: string; type: string; note: string; createdAt: string | null };
type Referrer = {
  id: string; contactId: string; name: string; company: string; email: string;
  profileUrl: string; notes: string; status: string; contactedAt: string | null;
  promisedAt: string | null; referralSubmittedAt: string | null; windowExpiresAt: string | null;
  referralSubmittedSource: "SYSTEM_EMAIL" | "CONTACT_EMAIL" | "MANUAL" | null; source: "GMAIL" | "MANUAL";
  events: ReferralEvent[];
};

const submittedSourceLabel = { SYSTEM_EMAIL: "confirmed by employer email", CONTACT_EMAIL: "they said so by email, not yet confirmed by employer", MANUAL: "logged by you" };

const actions = [
  { value: "CONTACTED", label: "Log outreach sent" },
  { value: "GENERIC_REPLY", label: "Generic reply received" },
  { value: "PROMISED", label: "Referral promised" },
  { value: "REFERRAL_SUBMITTED", label: "Referral actually submitted" },
  { value: "NO_RESPONSE", label: "No response" },
  { value: "DECLINED", label: "Declined" },
  { value: "NOTE", label: "Add note" }
];

function formatDate(value: string | null) {
  if (!value) return "Not recorded";
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(new Date(value));
}

function labelStatus(value: string) {
  return value.replaceAll("_", " ").toLowerCase().replace(/^./, (c) => c.toUpperCase());
}

export function ReferralManager({ jobId, initialWaitHours = 48 }: { jobId: string; initialWaitHours?: number }) {
  const [referrers, setReferrers] = useState<Referrer[]>([]);
  const [waitHours, setWaitHours] = useState(String(initialWaitHours));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [actionById, setActionById] = useState<Record<string, string>>({});
  const [noteById, setNoteById] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/v1/jobs/${jobId}/referrers`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load referrers.");
      setReferrers(data.referrers ?? []);
      setWaitHours(String(data.referralWaitHours ?? 48));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load referrers.");
    } finally { setLoading(false); }
  }, [jobId]);

  useEffect(() => { void load(); }, [load]);

  async function addReferrer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setSuccess(""); setSaving(true);
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const payload = {
      name: String(form.get("name") || ""), company: String(form.get("company") || ""),
      email: String(form.get("email") || ""), profileUrl: String(form.get("profileUrl") || ""),
      notes: String(form.get("notes") || ""), referralWaitHours: Number(waitHours)
    };
    try {
      const response = await fetch(`/api/v1/jobs/${jobId}/referrers`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not add referrer.");
      formElement.reset();
      setSuccess("Referrer added to this job.");
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : "Could not add referrer."); }
    finally { setSaving(false); }
  }

  async function saveWaitWindow() {
    setError(""); setSuccess(""); setSaving(true);
    try {
      const response = await fetch(`/api/v1/jobs/${jobId}/referrers`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ referralWaitHours: Number(waitHours) })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not update referral wait window.");
      setSuccess("Referral wait window updated. Existing timers are unchanged.");
    } catch (err) { setError(err instanceof Error ? err.message : "Could not update referral wait window."); }
    finally { setSaving(false); }
  }

  async function logAction(referrerId: string) {
    setError(""); setSuccess(""); setSaving(true);
    try {
      const response = await fetch(`/api/v1/jobs/${jobId}/referrers/${referrerId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: actionById[referrerId] || "CONTACTED", note: noteById[referrerId] || "" })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not log outreach.");
      setNoteById((current) => ({ ...current, [referrerId]: "" }));
      setSuccess("Outreach event saved.");
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : "Could not log outreach."); }
    finally { setSaving(false); }
  }

  async function removeReferrer(referrerId: string) {
    if (!window.confirm("Remove this referrer from the job? Their outreach history will no longer appear here.")) return;
    setError(""); setSuccess("");
    try {
      const response = await fetch(`/api/v1/jobs/${jobId}/referrers/${referrerId}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not remove referrer.");
      setSuccess("Referrer removed from this job."); await load();
    } catch (err) { setError(err instanceof Error ? err.message : "Could not remove referrer."); }
  }

  return <section className="panel referral-panel">
    <div className="referral-heading">
      <div><p className="muted small" style={{ marginBottom: 6 }}>PHASE 3</p><h2 style={{ marginTop: 0 }}>Referral tracking</h2></div>
      <span className="pill">{referrers.length} {referrers.length === 1 ? "referrer" : "referrers"}</span>
    </div>
    <p className="muted small">Referrals are detected automatically when you sync Gmail: a “you’ve been referred” email adds the person here and marks the referral submitted. A promise is never treated as a submitted referral.</p>
    {error && <p className="error" role="alert">{error}</p>}{success && <p className="success" role="status">{success}</p>}

    <details>
    <summary className="small">Add someone manually (e.g. to track outreach before a referral email arrives)</summary>
    <form onSubmit={addReferrer}>
      <h3>Add a potential referrer</h3>
      <div className="form-grid-two">
        <div className="field"><label htmlFor="ref-name">Name *</label><input id="ref-name" name="name" required maxLength={120} /></div>
        <div className="field"><label htmlFor="ref-company">Company</label><input id="ref-company" name="company" maxLength={120} /></div>
        <div className="field"><label htmlFor="ref-email">Email</label><input id="ref-email" name="email" type="email" maxLength={254} /></div>
        <div className="field"><label htmlFor="ref-profile">Profile URL</label><input id="ref-profile" name="profileUrl" type="url" placeholder="https://..." maxLength={2048} /></div>
      </div>
      <div className="field"><label htmlFor="ref-notes">Context / notes</label><textarea id="ref-notes" name="notes" rows={2} maxLength={2000} placeholder="How you know them, relevant team, or other context" /></div>
      <div className="field"><label htmlFor="ref-wait">Referral wait window (hours, 1–168)</label><input id="ref-wait" type="number" min={1} max={168} required value={waitHours} onChange={(e) => setWaitHours(e.target.value)} /></div>
      <div className="actions"><button className="button" type="submit" disabled={saving}> {saving ? "Saving…" : "Add referrer"} </button><button className="button secondary" type="button" disabled={saving || !Number.isInteger(Number(waitHours)) || Number(waitHours) < 1 || Number(waitHours) > 168} onClick={() => void saveWaitWindow()}>Save wait window</button></div>
    </form>
    </details>

    <div className="referrer-list">
      <h3>People for this job</h3>
      {loading ? <p className="muted">Loading referral records…</p> : referrers.length === 0 ? <p className="muted">No referrals yet. Sync Gmail after someone refers you and they’ll appear here.</p> : referrers.map((referrer) => <article className="referrer-card" key={referrer.id}>
        <div className="referrer-top">
          <div><h3>{referrer.name}{referrer.source === "GMAIL" && <span className="pill" style={{ marginLeft: 8 }}>from Gmail</span>}</h3><p className="muted small">{referrer.company || "Company not specified"} · {labelStatus(referrer.status)}</p></div>
          <button className="button secondary small-button" type="button" onClick={() => void removeReferrer(referrer.id)}>Remove</button>
        </div>
        <div className="referrer-links small">
          {referrer.email && <a href={`mailto:${referrer.email}`}>{referrer.email}</a>}
          {referrer.profileUrl && <a href={referrer.profileUrl} target="_blank" rel="noreferrer">Open profile ↗</a>}
          {referrer.notes && <span className="muted">{referrer.notes}</span>}
        </div>
        <div className="referrer-timing small">
          <span>First contacted: {formatDate(referrer.contactedAt)}</span>
          <span>Referral promised: {formatDate(referrer.promisedAt)}</span>
          <span>Referral submitted: {formatDate(referrer.referralSubmittedAt)}{referrer.referralSubmittedAt && referrer.referralSubmittedSource && ` (${submittedSourceLabel[referrer.referralSubmittedSource]})`}</span>
          {referrer.windowExpiresAt && <span>Wait window ends: {formatDate(referrer.windowExpiresAt)}</span>}
        </div>
        <div className="outreach-controls">
          <div className="field"><label htmlFor={`action-${referrer.id}`}>Record an event</label><select id={`action-${referrer.id}`} value={actionById[referrer.id] || "CONTACTED"} onChange={(e) => setActionById((current) => ({ ...current, [referrer.id]: e.target.value }))}>{actions.map((action) => <option key={action.value} value={action.value}>{action.label}</option>)}</select></div>
          <div className="field"><label htmlFor={`note-${referrer.id}`}>Optional note</label><input id={`note-${referrer.id}`} value={noteById[referrer.id] || ""} maxLength={2000} onChange={(e) => setNoteById((current) => ({ ...current, [referrer.id]: e.target.value }))} placeholder="e.g. messaged on LinkedIn" /></div>
          <button className="button" type="button" disabled={saving} onClick={() => void logAction(referrer.id)}>Save event</button>
        </div>
        {referrer.events.length > 0 && <details className="event-history"><summary>Outreach history ({referrer.events.length})</summary><ul>{referrer.events.map((item) => <li key={item.id}><strong>{labelStatus(item.type)}</strong> <span className="muted">· {formatDate(item.createdAt)}</span>{item.note && <p>{item.note}</p>}</li>)}</ul></details>}
      </article>)}
    </div>
    <p className="muted small">The wait timer starts only when you log the first outreach sent. Later replies or promises never restart it. Logging “Referral actually submitted” is a manual confirmation.</p>
  </section>;
}
