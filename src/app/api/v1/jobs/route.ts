import { NextResponse } from "next/server";
import { ObjectId, type Document } from "mongodb";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/mongodb";
import { hasTrustedOrigin, jsonError } from "@/lib/http";
import { extractJobDetails, jobInputSchema, normalizeJobUrl } from "@/lib/jobs";
import { fetchPublicPage } from "@/lib/public-fetch";

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

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return jsonError("Authentication required.", 401);
  const db = await getDb();
  const jobs = await db.collection("jobs")
    .find({ userId: new ObjectId(user.id), archivedAt: null })
    .sort({ createdAt: -1 }).limit(100).toArray();
  return NextResponse.json({ jobs: jobs.map((job) => serialize(job)) });
}

export async function POST(request: Request) {
  if (!hasTrustedOrigin(request)) return jsonError("Invalid request origin.", 403);
  const user = await getCurrentUser();
  if (!user) return jsonError("Authentication required.", 401);

  const body = await request.json().catch(() => null);
  const parsed = jobInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Please check the job details.", fields: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  let normalizedSourceUrl: string;
  try { normalizedSourceUrl = normalizeJobUrl(parsed.data.sourceUrl); }
  catch { return jsonError("Enter a valid job URL.", 400); }

  const deadlineAt = parsed.data.deadlineAt ? new Date(parsed.data.deadlineAt) : null;
  if (deadlineAt && Number.isNaN(deadlineAt.getTime())) return jsonError("Enter a valid deadline.", 400);

  let company = parsed.data.company || "";
  let title = parsed.data.title || "";
  if (!company || !title) {
    // Gmail matching needs company/title; fill blanks from the posting. Unreadable page = stay blank.
    try {
      const page = await fetchPublicPage(parsed.data.sourceUrl);
      if (page.status >= 200 && page.status < 300) {
        const detected = extractJobDetails(page.html, parsed.data.sourceUrl);
        company ||= detected.company;
        title ||= detected.title;
      }
    } catch { /* blocked, private, timed out, or not HTML */ }
  }
  // Gmail matching filters emails by company, so a job without one is useless to sync.
  if (!company) return NextResponse.json({ error: "Couldn't detect the company from this URL. Please enter the company name.", fields: { company: ["Required"] } }, { status: 400 });

  const now = new Date();
  const document = {
    userId: new ObjectId(user.id),
    sourceUrl: parsed.data.sourceUrl, normalizedSourceUrl,
    applicationUrl: parsed.data.applicationUrl || "",
    company, title,
    location: parsed.data.location || "", description: parsed.data.description || "",
    deadlineAt,
    deadlineConfidence: deadlineAt ? parsed.data.deadlineConfidence : "UNKNOWN",
    availabilityStatus: parsed.data.availabilityStatus,
    availabilityVerifiedAt: ["OPEN", "CLOSED"].includes(parsed.data.availabilityStatus) ? now : null,
    referralWaitHours: 48, timerStartedAt: null, referralWindowExpiresAt: null,
    archivedAt: null, createdAt: now, updatedAt: now
  };

  const db = await getDb();
  try {
    const result = await db.collection("jobs").insertOne(document);
    return NextResponse.json({ job: serialize({ ...document, _id: result.insertedId }) }, { status: 201 });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === 11000) {
      return jsonError("This job URL already exists in your jobs list.", 409);
    }
    throw error;
  }
}
