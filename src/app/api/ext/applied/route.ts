import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getUserFromBearer } from "@/lib/auth";
import { getDb } from "@/lib/mongodb";
import { jsonError } from "@/lib/http";
import { findJobForUrl } from "@/lib/job-match";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ url: z.string().url().max(4096) });

/** The extension saw an "application submitted" page: mark that saved job Applied (unless you switched it off yourself). */
export async function POST(request: Request) {
  const user = await getUserFromBearer(request);
  if (!user) return jsonError("Token invalid or disconnected.", 401);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Invalid page.", 400);
  const db = await getDb(); const userId = new ObjectId(user.id);
  const job = await findJobForUrl(db, userId, parsed.data.url);
  if (!job) return NextResponse.json({ matched: false });
  if (job.applied !== true && !(job.appliedSetBy === "USER" && job.applied === false)) {
    const now = new Date();
    await db.collection("jobs").updateOne({ _id: job._id, userId }, { $set: { applied: true, appliedSetBy: "EXTENSION", appliedAt: now, emailDetectedApplicationStatus: "SUBMITTED", updatedAt: now } });
  }
  return NextResponse.json({ matched: true, company: String(job.company || ""), title: String(job.title || "") });
}
