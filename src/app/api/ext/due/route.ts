import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getUserFromBearer } from "@/lib/auth";
import { getDb } from "@/lib/mongodb";
import { jsonError } from "@/lib/http";
import { isApplied } from "@/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Jobs you haven't applied to whose deadline is within the next 48 hours (for the extension badge). */
export async function GET(request: Request) {
  const user = await getUserFromBearer(request);
  if (!user) return jsonError("Token invalid or disconnected.", 401);
  const now = new Date();
  const jobs = await (await getDb()).collection("jobs")
    .find({ userId: new ObjectId(user.id), archivedAt: null, availabilityStatus: { $ne: "CLOSED" }, deadlineAt: { $gte: now, $lte: new Date(now.getTime() + 48 * 60 * 60 * 1000) } })
    .sort({ deadlineAt: 1 }).limit(20).toArray();
  return NextResponse.json({
    jobs: jobs.filter((job) => !isApplied(job)).map((job) => ({
      id: String(job._id), company: String(job.company || ""), title: String(job.title || "Untitled role"),
      url: String(job.applicationUrl || job.sourceUrl), deadlineAt: (job.deadlineAt as Date).toISOString(), referredBy: job.referred ? String(job.referredBy || "") : ""
    }))
  });
}
