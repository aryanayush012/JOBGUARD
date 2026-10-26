import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/mongodb";
import { hasTrustedOrigin, jsonError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const actionSchema = z.object({
  action: z.enum(["CONTACTED", "GENERIC_REPLY", "PROMISED", "REFERRAL_SUBMITTED", "NO_RESPONSE", "DECLINED", "NOTE"]),
  note: z.string().trim().max(2000).optional().default("")
});
const statusByAction: Record<string, string> = {
  CONTACTED: "CONTACTED", GENERIC_REPLY: "RESPONDED", PROMISED: "PROMISED",
  REFERRAL_SUBMITTED: "REFERRAL_SUBMITTED", NO_RESPONSE: "NO_RESPONSE", DECLINED: "DECLINED"
};

export async function PATCH(request: Request, context: { params: Promise<{ id: string; referrerId: string }> }) {
  if (!hasTrustedOrigin(request)) return jsonError("Invalid request origin.", 403);
  const user = await getCurrentUser();
  if (!user) return jsonError("Authentication required.", 401);
  const { id, referrerId } = await context.params;
  if (!ObjectId.isValid(id) || !ObjectId.isValid(referrerId)) return jsonError("Referral record not found.", 404);
  const body = await request.json().catch(() => null);
  const parsed = actionSchema.safeParse(body);
  if (!parsed.success) return jsonError("Choose a valid outreach action and check the note.", 400);

  const db = await getDb();
  const userId = new ObjectId(user.id);
  const jobId = new ObjectId(id);
  const mappingId = new ObjectId(referrerId);
  const mapping = await db.collection("jobReferrers").findOne({ _id: mappingId, userId, jobId });
  if (!mapping) return jsonError("Referral record not found.", 404);
  const now = new Date();
  const update: Record<string, unknown> = { updatedAt: now };

  if (parsed.data.action === "CONTACTED" && !mapping.contactedAt) {
    const job = await db.collection("jobs").findOne({ _id: jobId, userId }, { projection: { referralWaitHours: 1 } });
    const waitHours = Math.max(1, Math.min(168, Number(job?.referralWaitHours ?? 48)));
    update.contactedAt = now;
    update.windowExpiresAt = new Date(now.getTime() + waitHours * 60 * 60 * 1000);
  }
  if (parsed.data.action === "PROMISED") update.promisedAt = now;
  if (parsed.data.action === "REFERRAL_SUBMITTED" && mapping.referralSubmittedSource !== "SYSTEM_EMAIL") {
    update.referralSubmittedAt = now; update.referralSubmittedSource = "MANUAL";
  }
  if (statusByAction[parsed.data.action] && (mapping.status !== "REFERRAL_SUBMITTED" || parsed.data.action === "REFERRAL_SUBMITTED")) update.status = statusByAction[parsed.data.action];

  await db.collection("jobReferrers").updateOne({ _id: mappingId, userId, jobId }, { $set: update });
  await db.collection("referralEvents").insertOne({
    userId, jobId, referrerId: mappingId, type: parsed.data.action,
    note: parsed.data.note, createdAt: now
  });
  const updated = await db.collection("jobReferrers").findOne({ _id: mappingId, userId, jobId });
  return NextResponse.json({ ok: true, status: updated?.status, contactedAt: updated?.contactedAt ?? null, promisedAt: updated?.promisedAt ?? null, referralSubmittedAt: updated?.referralSubmittedAt ?? null, windowExpiresAt: updated?.windowExpiresAt ?? null });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string; referrerId: string }> }) {
  if (!hasTrustedOrigin(request)) return jsonError("Invalid request origin.", 403);
  const user = await getCurrentUser();
  if (!user) return jsonError("Authentication required.", 401);
  const { id, referrerId } = await context.params;
  if (!ObjectId.isValid(id) || !ObjectId.isValid(referrerId)) return jsonError("Referral record not found.", 404);
  const db = await getDb();
  const result = await db.collection("jobReferrers").deleteOne({ _id: new ObjectId(referrerId), jobId: new ObjectId(id), userId: new ObjectId(user.id) });
  if (!result.deletedCount) return jsonError("Referral record not found.", 404);
  return NextResponse.json({ ok: true });
}
