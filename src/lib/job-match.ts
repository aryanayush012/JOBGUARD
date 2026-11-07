import "server-only";
import type { Db, ObjectId } from "mongodb";
import { normalizeJobUrl } from "@/lib/jobs";

type MatchedJob = { _id: ObjectId; company?: string; title?: string; normalizedSourceUrl?: string; applicationUrl?: string; applied?: boolean; appliedSetBy?: string };

/** The saved job an application page belongs to: same posting URL, or the apply/confirmation page under it. */
export async function findJobForUrl(db: Db, userId: ObjectId, pageUrl: string) {
  let page: string;
  try { page = normalizeJobUrl(pageUrl).split("?")[0].replace(/\/(apply|application|thank-?you|confirmation|submitted)(\/.*)?$/i, ""); } catch { return null; }
  const jobs = await db.collection("jobs").find({ userId, archivedAt: null })
    .project<MatchedJob>({ company: 1, title: 1, normalizedSourceUrl: 1, applicationUrl: 1, applied: 1, appliedSetBy: 1 }).limit(300).toArray();
  const norm = (u?: string) => { try { return u ? normalizeJobUrl(u).split("?")[0] : ""; } catch { return ""; } };
  return jobs.find((j) => [norm(j.normalizedSourceUrl), norm(j.applicationUrl)].some((u) => u && (page.startsWith(u) || u.startsWith(page)))) ?? null;
}
