import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/mongodb";
import { hasTrustedOrigin, jsonError } from "@/lib/http";
import { fetchPublicPage } from "@/lib/public-fetch";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function assess(httpStatus: number, text: string) {
  const t = text.toLowerCase();
  if ([404, 410].includes(httpStatus)) return { availabilityStatus: "CLOSED", confidence: "MEDIUM", evidence: `HTTP ${httpStatus}` };
  if (httpStatus === 401 || httpStatus === 403 || httpStatus === 429 || httpStatus >= 500) return { availabilityStatus: "UNVERIFIED", confidence: "LOW", evidence: `HTTP ${httpStatus}; access blocked or server error` };
  if (/job (posting )?(is )?(no longer available|has expired|is closed)|position has been filled|this job is no longer available|applications (are|have been) closed|job has been taken down|this role is no longer accepting applications/.test(t)) return { availabilityStatus: "CLOSED", confidence: "HIGH", evidence: "Page contains explicit closure wording" };
  if (/apply now|submit application|apply for this job|easy apply/.test(t) && !/no longer available|applications closed|position filled/.test(t) && httpStatus >= 200 && httpStatus < 300) return { availabilityStatus: "OPEN", confidence: "MEDIUM", evidence: "Page contains an application action" };
  return { availabilityStatus: "UNKNOWN", confidence: "LOW", evidence: `HTTP ${httpStatus}; no reliable availability signal found` };
}
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!hasTrustedOrigin(request)) return jsonError("Invalid request origin.", 403); const user = await getCurrentUser(); if (!user) return jsonError("Authentication required.", 401);
  const { id } = await context.params; if (!ObjectId.isValid(id)) return jsonError("Job not found.", 404); const db = await getDb(); const filter = { _id: new ObjectId(id), userId: new ObjectId(user.id), archivedAt: null }; const job = await db.collection("jobs").findOne(filter); if (!job) return jsonError("Job not found.", 404);
  try {
    const page = await fetchPublicPage(String(job.sourceUrl)); const result = assess(page.status, page.text); const now = new Date();
    await db.collection("jobs").updateOne(filter, { $set: { availabilityStatus: result.availabilityStatus, availabilityCheckConfidence: result.confidence, availabilityEvidence: result.evidence, availabilityCheckedAt: now, availabilityHttpStatus: page.status, updatedAt: now } });
    await db.collection("availabilityChecks").insertOne({ userId: new ObjectId(user.id), jobId: new ObjectId(id), sourceUrl: job.sourceUrl, ...result, httpStatus: page.status, checkedAt: now });
    return NextResponse.json({ ok: true, ...result, httpStatus: page.status, checkedAt: now.toISOString() });
  } catch (error) {
    const now = new Date(); await db.collection("jobs").updateOne(filter, { $set: { availabilityStatus: "UNVERIFIED", availabilityCheckConfidence: "LOW", availabilityEvidence: "Check failed; status is unknown", availabilityCheckedAt: now, updatedAt: now } });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not check this job URL.", availabilityStatus: "UNVERIFIED" }, { status: 422 });
  }
}
