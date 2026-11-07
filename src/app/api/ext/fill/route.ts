import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getUserFromBearer } from "@/lib/auth";
import { getDb } from "@/lib/mongodb";
import { jsonError } from "@/lib/http";
import { loadProfile } from "@/lib/profile";
import { planAnswers, profileText } from "@/lib/profile-fields";
import { draftAnswers, geminiConfigured } from "@/lib/gemini";
import { normalizeJobUrl } from "@/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const schema = z.object({
  url: z.string().url().max(4096),
  questions: z.array(z.object({
    id: z.string().max(200), label: z.string().trim().min(1).max(500),
    options: z.array(z.string().max(300)).max(200).optional()
  })).max(150)
});

/**
 * The extension sends a form's questions; answers come back from the answer bank, and the rest as
 * AI drafts (shown to you for approval, never saved until you approve). Sensitive questions are skipped.
 */
export async function POST(request: Request) {
  const user = await getUserFromBearer(request);
  if (!user) return jsonError("Token invalid or disconnected.", 401);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Invalid form data.", 400);
  const { url, questions } = parsed.data;
  const db = await getDb(); const userId = new ObjectId(user.id);

  const [{ fields }, job] = await Promise.all([loadProfile(db, userId), findJob(db, userId, url)]);
  const { answers, unknown, skipped } = planAnswers(questions, fields);

  let drafts: { id: string; value: string; source: "AI" }[] = []; let aiError: string | undefined;
  if (unknown.length && geminiConfigured()) {
    try {
      const drafted = await draftAnswers(profileText(fields), unknown, { company: job?.company, title: job?.title });
      drafts = [...drafted].map(([id, value]) => ({ id, value, source: "AI" as const }));
    } catch (error) { aiError = error instanceof Error ? error.message : "AI drafting failed."; }
  }
  return NextResponse.json({ job, answers: [...answers, ...drafts], skipped, aiError, aiEnabled: geminiConfigured() });
}

/** The saved job this application page belongs to (same posting URL, or the apply page under it). */
async function findJob(db: Awaited<ReturnType<typeof getDb>>, userId: ObjectId, pageUrl: string) {
  let page: string;
  try { page = normalizeJobUrl(pageUrl).replace(/\/(apply|application)(\/.*)?$/i, ""); } catch { return null; }
  const jobs = await db.collection("jobs").find({ userId, archivedAt: null }).project<{ _id: ObjectId; company?: string; title?: string; normalizedSourceUrl?: string; applicationUrl?: string }>({ company: 1, title: 1, normalizedSourceUrl: 1, applicationUrl: 1 }).limit(200).toArray();
  const norm = (u?: string) => { try { return u ? normalizeJobUrl(u).split("?")[0] : ""; } catch { return ""; } };
  const base = page.split("?")[0];
  const job = jobs.find((j) => [norm(j.normalizedSourceUrl), norm(j.applicationUrl)].some((u) => u && (base.startsWith(u) || u.startsWith(base))));
  return job ? { id: String(job._id), company: String(job.company || ""), title: String(job.title || "") } : null;
}
