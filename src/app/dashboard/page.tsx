import Link from "next/link";
import { redirect } from "next/navigation";
import { ObjectId } from "mongodb";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/mongodb";
import { jobTab, type JobTab } from "@/lib/jobs";
import { LogoutButton } from "@/components/logout-button";
import { JobForm } from "@/components/job-form";
import { GmailConnectionPanel } from "@/components/gmail-connection-panel";

export const dynamic = "force-dynamic";

type Job = {
  _id: ObjectId; sourceUrl: string; company?: string; title?: string; location?: string;
  deadlineAt?: Date | null; deadlineConfidence?: string; availabilityStatus?: string; createdAt?: Date; emailDetectedApplicationStatus?: string; emailDetectedReferralStatus?: string; lastEmailEvidenceAt?: Date | null;
  referred?: boolean; referredBy?: string; applied?: boolean;
};

const TABS: { key: JobTab; label: string; empty: string }[] = [
  { key: "not-applied", label: "Not applied", empty: "Nothing waiting. New jobs you save land here." },
  { key: "referred", label: "Referred", empty: "No referred jobs yet. A job moves here when a referral email arrives or you switch on “Got referral”." },
  { key: "applied", label: "Applied", empty: "No applications yet. A job moves here when an application email arrives or you switch on “Applied”." }
];

function statusLabel(value?: string) {
  return value === "OPEN" ? "Open" : value === "CLOSED" ? "Closed" : value === "UNKNOWN" ? "Unknown" : "Unverified";
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const requested = (await searchParams).tab;
  const tab = TABS.find((t) => t.key === requested) ?? TABS[0];
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const db = await getDb();
  const jobs = await db.collection<Job>("jobs")
    .find({ userId: new ObjectId(user.id), archivedAt: null })
    .sort({ createdAt: -1 }).limit(100).toArray();

  const gmailConnection = await db.collection("gmailConnections").findOne({ userId: new ObjectId(user.id), status: "CONNECTED" });

  const openCount = jobs.filter((job) => job.availabilityStatus === "OPEN").length;
  const unverifiedCount = jobs.filter((job) => !job.availabilityStatus || ["UNKNOWN", "UNVERIFIED"].includes(job.availabilityStatus)).length;
  const tabCounts = Object.fromEntries(TABS.map((t) => [t.key, jobs.filter((job) => jobTab(job) === t.key).length]));
  const visibleJobs = jobs.filter((job) => jobTab(job) === tab.key);

  return (
    <main className="page">
      <nav className="nav">
        <Link href="/" className="brand" style={{ textDecoration: "none" }}>JOB<span>GUARD</span></Link>
        <div className="actions"><span className="muted small">{user.email}</span><LogoutButton /></div>
      </nav>
      <section className="hero">
        <p className="muted">YOUR WORKSPACE</p>
        <h1>Protect your next opportunity.</h1>
        <p className="muted">Save jobs, track potential referrers, and record outreach without losing sight of application deadlines.</p>
      </section>
      <GmailConnectionPanel connected={Boolean(gmailConnection)} email={gmailConnection?.email ? String(gmailConnection.email) : undefined} lastSyncedAt={gmailConnection?.lastSyncedAt instanceof Date ? gmailConnection.lastSyncedAt.toISOString() : null} />
      <section className="grid" style={{ marginBottom: 28 }}>
        <div className="panel stat"><strong>{jobs.length}</strong><span>Jobs tracked</span></div>
        <div className="panel stat"><strong>{openCount}</strong><span>Marked open</span></div>
        <div className="panel stat"><strong>{unverifiedCount}</strong><span>Need verification</span></div>
      </section>
      <section className="panel" style={{ marginBottom: 28 }}>
        <h2>Add a job</h2>
        <p className="muted small">Paste a posting URL and fill in what you know. Unknown details can stay blank.</p>
        <JobForm />
      </section>
      <section>
        <div className="actions" style={{ justifyContent: "space-between", marginBottom: 16 }}>
          <h2 style={{ margin: 0 }}>Your jobs</h2><span className="muted small">Showing up to 100 recent jobs</span>
        </div>
        <nav className="actions" aria-label="Job status" style={{ marginBottom: 16 }}>
          {TABS.map((t) => (
            <Link key={t.key} href={`/dashboard?tab=${t.key}`} scroll={false} aria-current={t.key === tab.key ? "page" : undefined}
              className={t.key === tab.key ? "button" : "button secondary"}>
              {t.label} ({tabCounts[t.key]})
            </Link>
          ))}
        </nav>
        {visibleJobs.length === 0 ? <div className="panel"><p>{jobs.length === 0 ? "No jobs saved yet. Add your first opportunity above." : tab.empty}</p></div> : (
          <div style={{ display: "grid", gap: 12 }}>
            {visibleJobs.map((job) => (
              <article className="panel job-card" key={job._id.toString()}>
                <div className="job-card-top">
                  <div style={{ minWidth: 0 }}>
                    <h3>{job.title || "Untitled role"}</h3>
                    <p className="muted">{job.company || "Company not added"}</p>
                  </div>
                  <div className="job-card-icons">
                    <a href={job.sourceUrl} target="_blank" rel="noreferrer" className="icon-button" aria-label="Open job posting" title="Open job posting">
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg>
                    </a>
                    <Link href={`/jobs/${job._id.toString()}`} className="icon-button" aria-label="Edit job" title="Edit job">
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4zM13.5 6.5l4 4" /></svg>
                    </Link>
                  </div>
                </div>
                <p className="small job-card-deadline">
                  {job.deadlineAt ? <>Deadline: <strong>{new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" }).format(job.deadlineAt)}</strong></> : <span className="muted">No deadline set</span>}
                </p>
                <div className="chips">
                  {jobTab(job) === "applied" && <span className="chip chip-applied">Applied</span>}
                  {job.referred && <span className="chip chip-referred">{job.referredBy ? `Referred by ${job.referredBy}` : "Referred"}</span>}
                  <span className={`chip chip-status-${(job.availabilityStatus || "UNVERIFIED").toLowerCase()}`}>{statusLabel(job.availabilityStatus)}</span>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
      <p className="footer">Phase 4 · Gmail evidence sync and job availability checks · No application is submitted automatically.</p>
    </main>
  );
}
