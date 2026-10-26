import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/mongodb";
import { hasTrustedOrigin, jsonError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const addSchema = z.object({
  name: z.string().trim().min(1).max(120),
  company: z.string().trim().max(120).optional().default(""),
  email: z.string().trim().max(254).optional().default(""),
  profileUrl: z.string().trim().max(2048).optional().default(""),
  notes: z.string().trim().max(2000).optional().default(""),
  referralWaitHours: z.number().int().min(1).max(168).optional()
});

function serializeDate(value: unknown) {
  return value instanceof Date ? value.toISOString() : null;
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return jsonError("Authentication required.", 401);
  const { id } = await context.params;
  if (!ObjectId.isValid(id)) return jsonError("Job not found.", 404);
  const db = await getDb();
  const userId = new ObjectId(user.id);
  const job = await db.collection("jobs").findOne({ _id: new ObjectId(id), userId, archivedAt: null }, { projection: { referralWaitHours: 1 } });
  if (!job) return jsonError("Job not found.", 404);

  const mappings = await db.collection("jobReferrers").find({ userId, jobId: new ObjectId(id) }).sort({ createdAt: -1 }).toArray();
  const contactIds = mappings.map((mapping) => mapping.contactId);
  const contacts = await db.collection("referralContacts").find({ _id: { $in: contactIds }, userId }).toArray();
  const contactById = new Map(contacts.map((contact) => [String(contact._id), contact]));
  const mappingIds = mappings.map((mapping) => mapping._id);
  const events = await db.collection("referralEvents").find({ userId, jobId: new ObjectId(id), referrerId: { $in: mappingIds } }).sort({ createdAt: -1 }).limit(200).toArray();
  const eventsByMapping = new Map<string, typeof events>();
  for (const event of events) {
    const key = String(event.referrerId);
    eventsByMapping.set(key, [...(eventsByMapping.get(key) ?? []), event]);
  }

  return NextResponse.json({
    referralWaitHours: Number(job.referralWaitHours ?? 48),
    referrers: mappings.map((mapping) => {
      const contact = contactById.get(String(mapping.contactId));
      return {
        id: String(mapping._id), contactId: String(mapping.contactId),
        name: contact?.name ?? "Deleted contact", company: contact?.company ?? "",
        email: contact?.email ?? "", profileUrl: contact?.profileUrl ?? "", notes: contact?.notes ?? "",
        status: mapping.status ?? "NOT_CONTACTED",
        contactedAt: serializeDate(mapping.contactedAt), promisedAt: serializeDate(mapping.promisedAt),
        referralSubmittedAt: serializeDate(mapping.referralSubmittedAt),
        referralSubmittedSource: mapping.referralSubmittedSource ?? null, source: mapping.source ?? "MANUAL",
        windowExpiresAt: serializeDate(mapping.windowExpiresAt), createdAt: serializeDate(mapping.createdAt),
        events: (eventsByMapping.get(String(mapping._id)) ?? []).map((event) => ({
          id: String(event._id), type: event.type, note: event.note ?? "", createdAt: serializeDate(event.createdAt)
        }))
      };
    })
  });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!hasTrustedOrigin(request)) return jsonError("Invalid request origin.", 403);
  const user = await getCurrentUser();
  if (!user) return jsonError("Authentication required.", 401);
  const { id } = await context.params;
  if (!ObjectId.isValid(id)) return jsonError("Job not found.", 404);
  const body = await request.json().catch(() => null);
  const parsed = addSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Please check the referrer details.", fields: parsed.error.flatten().fieldErrors }, { status: 400 });

  const profileUrl = parsed.data.profileUrl || "";
  if (profileUrl) {
    try { if (!["http:", "https:"].includes(new URL(profileUrl).protocol)) throw new Error(); }
    catch { return jsonError("Enter a valid profile URL starting with http:// or https://.", 400); }
  }
  const email = parsed.data.email.toLowerCase();
  if (email && !z.string().email().safeParse(email).success) return jsonError("Enter a valid email address.", 400);

  const db = await getDb();
  const userId = new ObjectId(user.id);
  const jobId = new ObjectId(id);
  const job = await db.collection("jobs").findOne({ _id: jobId, userId, archivedAt: null });
  if (!job) return jsonError("Job not found.", 404);

  const now = new Date();
  const waitHours = parsed.data.referralWaitHours ?? Number(job.referralWaitHours ?? 48);
  const contact = {
    userId, name: parsed.data.name, company: parsed.data.company, email,
    normalizedEmail: email || undefined, profileUrl, notes: parsed.data.notes,
    createdAt: now, updatedAt: now
  };
  const contactResult = await db.collection("referralContacts").insertOne(contact);
  const mapping = {
    userId, jobId, contactId: contactResult.insertedId,
    status: "NOT_CONTACTED", contactedAt: null, promisedAt: null,
    referralSubmittedAt: null, windowExpiresAt: null,
    createdAt: now, updatedAt: now
  };
  const mappingResult = await db.collection("jobReferrers").insertOne(mapping);
  await db.collection("jobs").updateOne({ _id: jobId, userId }, { $set: { referralWaitHours: waitHours, updatedAt: now } });
  return NextResponse.json({ referrer: { ...mapping, id: String(mappingResult.insertedId), contactId: String(contactResult.insertedId), name: contact.name, company: contact.company, email: contact.email, profileUrl: contact.profileUrl, notes: contact.notes, events: [] }, referralWaitHours: waitHours }, { status: 201 });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!hasTrustedOrigin(request)) return jsonError("Invalid request origin.", 403);
  const user = await getCurrentUser();
  if (!user) return jsonError("Authentication required.", 401);
  const { id } = await context.params;
  if (!ObjectId.isValid(id)) return jsonError("Job not found.", 404);
  const body = await request.json().catch(() => null);
  const parsed = z.object({ referralWaitHours: z.number().int().min(1).max(168) }).safeParse(body);
  if (!parsed.success) return jsonError("Referral wait window must be between 1 and 168 hours.", 400);
  const db = await getDb();
  const result = await db.collection("jobs").updateOne(
    { _id: new ObjectId(id), userId: new ObjectId(user.id), archivedAt: null },
    { $set: { referralWaitHours: parsed.data.referralWaitHours, updatedAt: new Date() } }
  );
  if (!result.matchedCount) return jsonError("Job not found.", 404);
  return NextResponse.json({ ok: true, referralWaitHours: parsed.data.referralWaitHours });
}
