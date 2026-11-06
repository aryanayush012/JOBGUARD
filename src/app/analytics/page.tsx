import Link from "next/link";
import { redirect } from "next/navigation";
import { ObjectId } from "mongodb";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/mongodb";
import { computeAnalytics } from "@/lib/analytics";
import { LogoutButton } from "@/components/logout-button";
import { AnalyticsView } from "@/components/analytics-view";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/analytics");
  const db = await getDb();
  const userId = new ObjectId(user.id);
  const [jobs, submitted] = await Promise.all([
    db.collection("jobs").find({ userId, archivedAt: null }).project<{ _id: ObjectId }>({ company: 1, title: 1, referred: 1, referredBy: 1, applied: 1, emailDetectedApplicationStatus: 1, deadlineAt: 1, sourceUrl: 1 }).toArray(),
    // Referral-manager contacts whose referral was actually submitted, with their names.
    db.collection("jobReferrers").aggregate<{ jobId: ObjectId; name: string }>([
      { $match: { userId, status: "REFERRAL_SUBMITTED" } },
      { $lookup: { from: "referralContacts", localField: "contactId", foreignField: "_id", as: "contact" } },
      { $project: { jobId: 1, name: { $first: "$contact.name" } } }
    ]).toArray()
  ]);
  const byJob = new Map<string, string[]>();
  for (const s of submitted) if (s.name) byJob.set(String(s.jobId), [...(byJob.get(String(s.jobId)) ?? []), s.name]);

  return (
    <main className="page page-wide">
      <nav className="nav">
        <Link href="/" className="brand" style={{ textDecoration: "none" }}>JOB<span>GUARD</span></Link>
        <div className="actions"><span className="muted small">{user.email}</span><LogoutButton /></div>
      </nav>
      <section className="hero">
        <p className="muted">ANALYTICS</p>
        <h1>Your search, at a glance.</h1>
        <p className="muted">Where every job stands, and who opened doors for you. Hover or click anything to dig in.</p>
      </section>
      <AnalyticsView data={computeAnalytics(jobs, byJob)} />
      <Link href="/dashboard" className="fab" aria-label="Dashboard">
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></svg>
      </Link>
    </main>
  );
}
