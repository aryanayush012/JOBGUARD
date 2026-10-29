import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { jsonError } from "@/lib/http";
import { isApplied } from "@/lib/jobs";
import { sendEmail } from "@/lib/mailer";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAY = 24 * 60 * 60 * 1000;
const IST = 5.5 * 60 * 60 * 1000; // India has no DST, so a fixed offset is exact

/** Daily (vercel.json): emails each user the jobs whose deadline is today (IST) and that they haven't applied to. */
export async function GET(request: Request) {
  if (!process.env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return jsonError("Unauthorized.", 401);
  const db = await getDb();
  const start = new Date(Math.floor((Date.now() + IST) / DAY) * DAY - IST);
  const end = new Date(start.getTime() + DAY);
  const due = (await db.collection("jobs").find({
    archivedAt: null, availabilityStatus: { $ne: "CLOSED" }, deadlineAt: { $gte: start, $lt: end },
    $or: [{ deadlineReminderSentAt: null }, { deadlineReminderSentAt: { $lt: start } }] // once per day, safe to re-run
  }).toArray()).filter((job) => !isApplied(job));

  const byUser = new Map<string, typeof due>();
  for (const job of due) byUser.set(String(job.userId), [...(byUser.get(String(job.userId)) || []), job]);
  const base = (process.env.APP_BASE_URL || "").replace(/\/$/, "");
  let emailsSent = 0; const failures: string[] = [];
  for (const jobs of byUser.values()) {
    // Prefer the Gmail address (Google verified it at connect time) over the unverified sign-up email.
    const connection = await db.collection("gmailConnections").findOne({ userId: jobs[0].userId, status: "CONNECTED" });
    const user = await db.collection("users").findOne({ _id: jobs[0].userId });
    const to = String(connection?.email || user?.email || "");
    if (!to) continue;
    try {
      const lines = jobs.map((job) => `• ${job.title || "Untitled role"} at ${job.company || "unknown company"}\n  ${job.applicationUrl || job.sourceUrl}`);
      const text = `The application deadline for ${jobs.length === 1 ? "this job is" : "these jobs is"} today. Apply before end of day:\n\n${lines.join("\n\n")}\n\nOpen your dashboard: ${base}/dashboard\n\n— JobGuard`;
      await sendEmail(to, `Apply before EOD: ${jobs.length} job deadline${jobs.length === 1 ? "" : "s"} today`, text);
      await db.collection("jobs").updateMany({ _id: { $in: jobs.map((job) => job._id) } }, { $set: { deadlineReminderSentAt: new Date() } });
      emailsSent++;
    } catch (error) {
      failures.push(`${to}: ${error instanceof Error ? error.message : "send failed"}`); // one user's failure doesn't stop the rest
    }
  }
  return NextResponse.json({ ok: true, jobsDue: due.length, emailsSent, failures });
}
