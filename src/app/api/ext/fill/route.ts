import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getUserFromBearer } from "@/lib/auth";
import { getDb } from "@/lib/mongodb";
import { jsonError } from "@/lib/http";
import { loadProfile } from "@/lib/profile";
import { planAnswers, profileText } from "@/lib/profile-fields";
import { draftAnswers, geminiConfigured } from "@/lib/gemini";
import { findJobForUrl } from "@/lib/job-match";
import { getSettings } from "@/lib/settings";

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

  const [{ fields }, job, settings] = await Promise.all([loadProfile(db, userId), findJob(db, userId, url), getSettings(db, userId)]);
  const { answers, unknown, skipped } = planAnswers(questions, fields);

  // Drafts send your profile and the form's questions to Gemini, so they only happen when you've turned AI assist on.
  const aiOn = settings.aiAssist && geminiConfigured();
  let drafts: { id: string; value: string; source: "AI" }[] = []; let aiError: string | undefined;
  if (unknown.length && aiOn) {
    try {
      const drafted = await draftAnswers(profileText(fields), unknown, { company: job?.company, title: job?.title });
      drafts = [...drafted].map(([id, value]) => ({ id, value, source: "AI" as const }));
    } catch (error) { aiError = error instanceof Error ? error.message : "AI drafting failed."; }
  }
  return NextResponse.json({ job, answers: [...answers, ...drafts], skipped, aiError, aiEnabled: aiOn, unanswered: aiOn ? 0 : unknown.length });
}

async function findJob(db: Awaited<ReturnType<typeof getDb>>, userId: ObjectId, pageUrl: string) {
  const job = await findJobForUrl(db, userId, pageUrl);
  return job ? { id: String(job._id), company: String(job.company || ""), title: String(job.title || "") } : null;
}
