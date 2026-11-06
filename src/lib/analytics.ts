import { jobTab } from "./jobs";

/**
 * Mutually exclusive job outcomes, so the donut never double-counts: "referred" and
 * "applied" overlap, so each outcome is split by whether the job had a referral.
 * Order = donut order = chart color slot (adjacent pairs validated for color-blind safety).
 */
export const SEGMENTS = [
  { key: "applied-referred", label: "Applied · referred", group: "Applied" },
  { key: "referred", label: "Referred, not applied yet", group: "Open" },
  { key: "not-applied", label: "Not applied", group: "Open" },
  { key: "missed-referred", label: "Missed · referred", group: "Missed" },
  { key: "missed", label: "Missed", group: "Missed" },
  { key: "applied", label: "Applied", group: "Applied" }
] as const;
export type SegmentKey = typeof SEGMENTS[number]["key"];

export type AnalyticsJob = { id: string; title: string; company: string; segment: SegmentKey; referrers: string[]; deadline: string | null; sourceUrl: string };
export type ReferralLink = { referrer: string; company: string; jobId: string };
export type Analytics = {
  jobs: AnalyticsJob[];
  counts: Record<SegmentKey, number>;
  links: ReferralLink[];
  totals: { jobs: number; referred: number; applied: number; missed: number; open: number; referrers: number; companies: number };
};

type JobDoc = Record<string, unknown> & { _id: unknown };
/** `submitted`: referrers from the referral manager whose referral was submitted, keyed by job id. */
export function computeAnalytics(jobDocs: JobDoc[], submitted: Map<string, string[]>, now = new Date()): Analytics {
  const counts = Object.fromEntries(SEGMENTS.map((s) => [s.key, 0])) as Record<SegmentKey, number>;
  const links: ReferralLink[] = [];
  const jobs = jobDocs.map((doc): AnalyticsJob => {
    const id = String(doc._id);
    const company = String(doc.company || "Unknown company").trim();
    // Who referred you: the name on the job (typed or from a referral email) plus submitted referral-manager contacts.
    const names = [...(doc.referred && doc.referredBy ? [String(doc.referredBy)] : []), ...(submitted.get(id) ?? [])];
    const referrers: string[] = [];
    for (const name of names.map((n) => n.trim())) if (name && !referrers.some((r) => r.toLowerCase() === name.toLowerCase())) referrers.push(name); // first spelling wins
    const referred = Boolean(doc.referred) || referrers.length > 0;
    if (referred && !referrers.length) referrers.push("Unnamed referrer");
    const tab = jobTab(doc, now);
    const segment: SegmentKey = tab === "applied" ? (referred ? "applied-referred" : "applied")
      : tab === "missed" ? (referred ? "missed-referred" : "missed")
      : referred ? "referred" : "not-applied";
    counts[segment]++;
    for (const referrer of referrers) links.push({ referrer, company, jobId: id });
    return { id, title: String(doc.title || "Untitled role"), company, segment, referrers, deadline: doc.deadlineAt instanceof Date ? doc.deadlineAt.toISOString() : null, sourceUrl: String(doc.sourceUrl || "") };
  });
  return {
    jobs, counts, links,
    totals: {
      jobs: jobs.length,
      referred: counts["applied-referred"] + counts.referred + counts["missed-referred"],
      applied: counts["applied-referred"] + counts.applied,
      missed: counts["missed-referred"] + counts.missed,
      open: counts.referred + counts["not-applied"],
      referrers: new Set(links.map((l) => l.referrer.toLowerCase())).size,
      companies: new Set(links.map((l) => l.company.toLowerCase())).size
    }
  };
}
