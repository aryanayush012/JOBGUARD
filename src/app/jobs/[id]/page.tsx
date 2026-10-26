import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ObjectId } from "mongodb";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/mongodb";
import { isApplied } from "@/lib/jobs";
import { LogoutButton } from "@/components/logout-button";
import { JobForm } from "@/components/job-form";
import { DeleteJobButton } from "@/components/delete-job-button";
import { CheckAvailabilityButton } from "@/components/check-availability-button";

export const dynamic = "force-dynamic";

export default async function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/jobs/${id}`)}`);
  if (!ObjectId.isValid(id)) notFound();

  const db = await getDb();
  const job = await db.collection("jobs").findOne({
    _id: new ObjectId(id), userId: new ObjectId(user.id), archivedAt: null
  });
  if (!job) notFound();

  const deadline = job.deadlineAt instanceof Date
    ? new Date(job.deadlineAt.getTime() - job.deadlineAt.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
    : "";

  return (
    <main className="page">
      <nav className="nav">
        <Link href="/dashboard" className="brand" style={{ textDecoration: "none" }}>JOB<span>GUARD</span></Link>
        <div className="actions"><span className="muted small">{user.email}</span><LogoutButton /></div>
      </nav>
      <div className="actions" style={{ justifyContent: "space-between", marginBottom: 20 }}>
        <div><p className="muted small">JOB DETAILS</p><h1 style={{ fontSize: "clamp(2rem, 5vw, 3rem)" }}>{job.title || "Untitled role"}</h1></div>
        <DeleteJobButton jobId={id} />
      </div>
      {(job.emailDetectedApplicationStatus || job.emailDetectedReferralStatus || job.lastEmailEvidenceAt) && (
        <section className="panel" style={{ marginBottom: 24 }}>
          <p className="muted small" style={{ marginTop: 0 }}>GMAIL-DERIVED STATUS</p>
          <h2 style={{ marginTop: 0 }}>Detected from your email</h2>
          {job.emailDetectedApplicationStatus && <p>Application status: <strong>{String(job.emailDetectedApplicationStatus).replaceAll("_", " ")}</strong></p>}
          {job.emailDetectedReferralStatus && <p>Referral status: <strong>{String(job.emailDetectedReferralStatus).replaceAll("_", " ")}</strong></p>}
          {job.lastEmailEvidenceAt instanceof Date && <p className="muted small">Last matching email: {new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(job.lastEmailEvidenceAt)}</p>}
          <p className="muted small">This status is inferred from email evidence and is shown separately from your manually maintained job details. Check the Gmail sync result for emails that need review.</p>
        </section>
      )}
      <section className="panel" style={{ marginBottom: 24 }}>
        <JobForm mode="edit" jobId={id} initial={{
          sourceUrl: String(job.sourceUrl || ""), applicationUrl: String(job.applicationUrl || ""),
          company: String(job.company || ""), title: String(job.title || ""), location: String(job.location || ""),
          description: String(job.description || ""), deadlineAt: deadline,
          deadlineConfidence: (job.deadlineConfidence || "UNKNOWN") as "VERIFIED" | "ESTIMATED" | "UNKNOWN",
          availabilityStatus: (job.availabilityStatus || "UNVERIFIED") as "OPEN" | "CLOSED" | "UNKNOWN" | "UNVERIFIED",
          referred: Boolean(job.referred), referredBy: String(job.referredBy || ""), applied: isApplied(job)
        }} referralNote={job.referralSetBy === "EMAIL" && job.referredAt instanceof Date
          ? `Detected from a referral email on ${new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" }).format(job.referredAt)}.`
          : undefined} appliedNote={job.appliedSetBy === "EMAIL" && job.appliedAt instanceof Date
          ? `Detected from an application email on ${new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" }).format(job.appliedAt)}.`
          : undefined} />
      </section>
      <CheckAvailabilityButton jobId={id} initialStatus={String(job.availabilityStatus || "UNVERIFIED")} checkedAt={job.availabilityCheckedAt instanceof Date ? job.availabilityCheckedAt.toISOString() : null} evidence={job.availabilityEvidence ? String(job.availabilityEvidence) : null} />
    </main>
  );
}
