import { NextResponse } from "next/server";
import { ObjectId, type Document } from "mongodb";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/mongodb";
import { hasTrustedOrigin, jsonError } from "@/lib/http";
import { isApplied, jobInputSchema, normalizeJobUrl } from "@/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function serialize(job: Document) {
  return {
    id: String(job._id), sourceUrl: job.sourceUrl, applicationUrl: job.applicationUrl ?? "",
    company: job.company ?? "", title: job.title ?? "", location: job.location ?? "",
    description: job.description ?? "",
    deadlineAt: job.deadlineAt instanceof Date ? job.deadlineAt.toISOString() : null,
    deadlineConfidence: job.deadlineConfidence ?? "UNKNOWN",
    availabilityStatus: job.availabilityStatus ?? "UNVERIFIED",
    createdAt: job.createdAt instanceof Date ? job.createdAt.toISOString() : null,
    updatedAt: job.updatedAt instanceof Date ? job.updatedAt.toISOString() : null
  };
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return jsonError("Authentication required.", 401);
  const { id } = await context.params;
  if (!ObjectId.isValid(id)) return jsonError("Job not found.", 404);
  const db = await getDb();
  const job = await db.collection("jobs").findOne({ _id: new ObjectId(id), userId: new ObjectId(user.id), archivedAt: null });
  if (!job) return jsonError("Job not found.", 404);
  return NextResponse.json({ job: serialize(job) });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!hasTrustedOrigin(request)) return jsonError("Invalid request origin.", 403);
  const user = await getCurrentUser();
  if (!user) return jsonError("Authentication required.", 401);
  const { id } = await context.params;
  if (!ObjectId.isValid(id)) return jsonError("Job not found.", 404);

  const body = await request.json().catch(() => null);
  const parsed = jobInputSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Please check the job details.", fields: parsed.error.flatten().fieldErrors }, { status: 400 });

  let normalizedSourceUrl: string;
  try { normalizedSourceUrl = normalizeJobUrl(parsed.data.sourceUrl); }
  catch { return jsonError("Enter a valid job URL.", 400); }
  if (!parsed.data.company) return jsonError("Company name is required: Gmail sync uses it to find this job's emails.", 400);

  const deadlineAt = parsed.data.deadlineAt ? new Date(parsed.data.deadlineAt) : null;
  if (deadlineAt && Number.isNaN(deadlineAt.getTime())) return jsonError("Enter a valid deadline.", 400);

  const db = await getDb();
  const filter = { _id: new ObjectId(id), userId: new ObjectId(user.id), archivedAt: null };
  const existing = await db.collection("jobs").findOne(filter);
  if (!existing) return jsonError("Job not found.", 404);

  const referredBy = parsed.data.referred ? parsed.data.referredBy : "";
  // Only a real change counts as the user's decision; after that, Gmail sync won't flip the switch back.
  const referralChanged = parsed.data.referred !== Boolean(existing.referred) || referredBy !== String(existing.referredBy || "");
  const appliedChanged = parsed.data.applied !== isApplied(existing);

  try {
    await db.collection("jobs").updateOne(filter, { $set: {
      referred: parsed.data.referred, referredBy,
      ...(referralChanged ? { referralSetBy: "USER" } : {}),
      applied: parsed.data.applied,
      ...(appliedChanged ? { appliedSetBy: "USER", appliedAt: parsed.data.applied ? new Date() : null } : {}),
      sourceUrl: parsed.data.sourceUrl, normalizedSourceUrl,
      applicationUrl: parsed.data.applicationUrl || "",
      company: parsed.data.company || "", title: parsed.data.title || "",
      location: parsed.data.location || "", description: parsed.data.description || "",
      deadlineAt, deadlineConfidence: deadlineAt ? parsed.data.deadlineConfidence : "UNKNOWN",
      availabilityStatus: parsed.data.availabilityStatus,
      availabilityVerifiedAt: ["OPEN", "CLOSED"].includes(parsed.data.availabilityStatus) ? new Date() : null,
      updatedAt: new Date()
    } });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === 11000) return jsonError("This job URL already exists in your jobs list.", 409);
    throw error;
  }

  const updated = await db.collection("jobs").findOne(filter);
  return NextResponse.json({ job: serialize(updated!) });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!hasTrustedOrigin(request)) return jsonError("Invalid request origin.", 403);
  const user = await getCurrentUser();
  if (!user) return jsonError("Authentication required.", 401);
  const { id } = await context.params;
  if (!ObjectId.isValid(id)) return jsonError("Job not found.", 404);
  const db = await getDb();
  const userId = new ObjectId(user.id);
  const jobId = new ObjectId(id);
  const result = await db.collection("jobs").deleteOne({ _id: jobId, userId });
  if (!result.deletedCount) return jsonError("Job not found.", 404);
  // Remove everything tied to the job. Its emails get re-evaluated (as unmatched) on the next Gmail sync.
  await Promise.all(["availabilityChecks", "gmailEvents", "jobReferrers", "referralEvents"].map((name) => db.collection(name).deleteMany({ userId, jobId })));
  return NextResponse.json({ ok: true });
}
