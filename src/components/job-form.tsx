"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

type JobValues = {
  sourceUrl: string; applicationUrl: string; company: string; title: string;
  location: string; description: string; deadlineAt: string;
  deadlineConfidence: "VERIFIED" | "ESTIMATED" | "UNKNOWN";
  availabilityStatus: "OPEN" | "CLOSED" | "UNKNOWN" | "UNVERIFIED";
  referred: boolean; referredBy: string; applied: boolean;
};

const empty: JobValues = {
  sourceUrl: "", applicationUrl: "", company: "", title: "", location: "", description: "",
  deadlineAt: "", deadlineConfidence: "UNKNOWN", availabilityStatus: "UNVERIFIED",
  referred: false, referredBy: "", applied: false
};

export function JobForm({ mode = "create", jobId, initial, referralNote, appliedNote }: {
  mode?: "create" | "edit"; jobId?: string; initial?: Partial<JobValues>; referralNote?: string; appliedNote?: string
}) {
  const router = useRouter();
  const [values, setValues] = useState<JobValues>({ ...empty, ...initial });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [detect, setDetect] = useState<"idle" | "detecting" | "found" | "missing">("idle");
  const autoCompany = useRef(""); // last value we filled in, so we never overwrite what the user typed

  function update<K extends keyof JobValues>(key: K, value: JobValues[K]) {
    setValues((previous) => ({ ...previous, [key]: value }));
  }

  // On create, detect company/title shortly after a valid URL is pasted or typed.
  useEffect(() => {
    if (mode !== "create") return;
    let url: URL;
    try { url = new URL(values.sourceUrl.trim()); } catch { setDetect("idle"); return; }
    if (!["http:", "https:"].includes(url.protocol)) { setDetect("idle"); return; }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setDetect("detecting");
      try {
        const response = await fetch("/api/v1/jobs/detect", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: url.toString() }), signal: controller.signal
        });
        const data = response.ok ? await response.json() as { company: string; title: string } : { company: "", title: "" };
        setValues((previous) => {
          const userTyped = previous.company && previous.company !== autoCompany.current;
          if (!userTyped) autoCompany.current = data.company;
          return { ...previous, company: userTyped ? previous.company : data.company, title: data.title };
        });
        setDetect(data.company ? "found" : "missing");
      } catch {
        if (!controller.signal.aborted) setDetect("missing");
      }
    }, 500);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [mode, values.sourceUrl]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(""); setSuccess("");
    try {
      const payload = { ...values, deadlineAt: values.deadlineAt ? new Date(values.deadlineAt).toISOString() : "" };
      const response = await fetch(mode === "edit" ? `/api/v1/jobs/${jobId}` : "/api/v1/jobs", {
        method: mode === "edit" ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      if (!response.ok) { setError(data.error || "Could not save this job."); return; }
      setSuccess(mode === "edit" ? "Job updated." : "Job saved.");
      router.refresh();
      if (mode === "create") { setValues(empty); autoCompany.current = ""; setDetect("idle"); }
    } catch {
      setError("Could not connect. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <div className="field">
        <label htmlFor="sourceUrl">Job posting URL *</label>
        <input id="sourceUrl" type="url" required maxLength={2048} placeholder="https://company.com/careers/job-id" value={values.sourceUrl} onChange={(e) => update("sourceUrl", e.target.value)} />
      </div>
      {/* Company is required: Gmail sync finds a job's emails by company name. */}
      <div className={mode === "edit" ? "grid form-grid-two" : undefined}>
        <div className="field">
          <label htmlFor="company">Company *</label>
          <input id="company" required maxLength={160} value={values.company} onChange={(e) => update("company", e.target.value)}
            placeholder={detect === "detecting" ? "Detecting from the job page…" : "Company name"} aria-describedby="company-hint" />
          {mode === "create" && (
            <span id="company-hint" className={detect === "missing" ? "error small" : "muted small"} role={detect === "missing" ? "alert" : undefined}>
              {detect === "detecting" ? "Detecting company from the job page…"
                : detect === "found" ? "Detected from the job page. Fix it if it's wrong."
                : detect === "missing" ? "Couldn't detect the company from this URL. Please enter it."
                : "Filled in automatically when you paste the job URL."}
            </span>
          )}
        </div>
        {mode === "edit" && <div className="field"><label htmlFor="title">Job title</label><input id="title" maxLength={200} value={values.title} onChange={(e) => update("title", e.target.value)} placeholder="Not detected" /></div>}
      </div>
      <div className="field"><label htmlFor="description">Notes (optional)</label><textarea id="description" maxLength={20000} rows={3} value={values.description} onChange={(e) => update("description", e.target.value)} placeholder="Anything worth remembering about this job…" /></div>
      <div className="grid form-grid-two">
        <div className="field"><label htmlFor="deadlineAt">Application deadline (optional)</label><input id="deadlineAt" type="datetime-local" value={values.deadlineAt} onChange={(e) => update("deadlineAt", e.target.value)} /></div>
        <div className="field"><label htmlFor="deadlineConfidence">Deadline confidence</label><select id="deadlineConfidence" value={values.deadlineConfidence} onChange={(e) => update("deadlineConfidence", e.target.value as JobValues["deadlineConfidence"])}><option value="UNKNOWN">Unknown</option><option value="ESTIMATED">Estimated</option><option value="VERIFIED">Verified</option></select></div>
      </div>
      {mode === "edit" && (
        <div className="field">
          <label htmlFor="referred" style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
            <input id="referred" type="checkbox" role="switch" checked={values.referred} onChange={(e) => update("referred", e.target.checked)} style={{ width: "auto" }} />
            Got referral
          </label>
          {values.referred && <input id="referredBy" aria-label="Referred by" maxLength={120} value={values.referredBy} onChange={(e) => update("referredBy", e.target.value)} placeholder="Name of the person who referred you" />}
          {referralNote && <span className="muted small">{referralNote}</span>}
        </div>
      )}
      {mode === "edit" && (
        <div className="field">
          <label htmlFor="applied" style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
            <input id="applied" type="checkbox" role="switch" checked={values.applied} onChange={(e) => update("applied", e.target.checked)} style={{ width: "auto" }} />
            Applied
          </label>
          {appliedNote && <span className="muted small">{appliedNote}</span>}
        </div>
      )}
      <div className="field"><label htmlFor="availabilityStatus">Job availability</label><select id="availabilityStatus" value={values.availabilityStatus} onChange={(e) => update("availabilityStatus", e.target.value as JobValues["availabilityStatus"])}><option value="UNVERIFIED">Unverified</option><option value="OPEN">Open (verified)</option><option value="CLOSED">Closed (verified)</option><option value="UNKNOWN">Unknown</option></select></div>
      {error && <p className="error" role="alert">{error}</p>}
      {success && <p className="success" role="status">{success}</p>}
      <button className="button" disabled={busy}>{busy ? "Saving…" : mode === "edit" ? "Save changes" : "Save job"}</button>
    </form>
  );
}
