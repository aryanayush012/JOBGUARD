import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/mongodb";
import { hasTrustedOrigin, jsonError } from "@/lib/http";
import { decryptToken, getAccessToken, gmailApi } from "@/lib/integrations/google-gmail";
import { detectReferral, parseFrom } from "@/lib/referral-email";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Header = { name: string; value: string };
type GmailMessage = { id: string; threadId?: string; snippet?: string; internalDate?: string; payload?: { headers?: Header[]; mimeType?: string; body?: { data?: string }; parts?: GmailMessage["payload"][] } };
function decodePart(payload?: GmailMessage["payload"]): string {
  if (!payload) return ""; let result = "";
  if (payload.body?.data) { try { result += Buffer.from(payload.body.data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"); } catch {} }
  for (const part of payload.parts || []) result += "\n" + decodePart(part);
  return result.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").slice(0, 12000);
}
function header(message: GmailMessage, name: string) { return message.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || ""; }
function classify(subject: string, text: string) {
  const all = `${subject}\n${text}`.toLowerCase();
  if (/application.{0,35}(was )?rejected|not moving forward|regret to inform|unsuccessful in your application|decided to pursue other candidates/.test(all)) return { type: "APPLICATION_REJECTED", confidence: "HIGH", label: "Application rejection" };
  if (/interview.{0,35}(invite|invitation|scheduled|availability)|schedule.{0,20}interview|technical interview|meet with.{0,30}(team|hiring manager)/.test(all)) return { type: "INTERVIEW_UPDATE", confidence: "MEDIUM", label: "Interview update" };
  if (/referral.{0,40}(submitted|successfully referred|has referred|was referred)|referred you for|employee referral.{0,30}(complete|submitted)/.test(all)) return { type: "REFERRAL_REPORTED", confidence: "MEDIUM", label: "Referral mentioned" };
  if (/thank you for applying|application (has been|was) received|successfully applied|we have received your application|application confirmation|your application for/.test(all)) return { type: "APPLICATION_SUBMITTED", confidence: "HIGH", label: "Application confirmation" };
  if (/under review|reviewing your application|application status update|recruiter.{0,25}(reached out|contact)|next steps in the hiring/.test(all)) return { type: "APPLICATION_UPDATE", confidence: "MEDIUM", label: "Application update" };
  if (/job.{0,20}(closed|no longer available)|position.{0,20}(filled|closed)|applications are now closed/.test(all)) return { type: "JOB_CLOSED_NOTICE", confidence: "MEDIUM", label: "Job closure mentioned" };
  return null;
}
export async function POST(request: Request) {
  if (!hasTrustedOrigin(request)) return jsonError("Invalid request origin.", 403); const user = await getCurrentUser(); if (!user) return jsonError("Authentication required.", 401);
  const db = await getDb(); const userId = new ObjectId(user.id); const connection = await db.collection("gmailConnections").findOne({ userId, status: "CONNECTED" });
  if (!connection?.encryptedRefreshToken) return jsonError("Connect Gmail before syncing.", 400);
  try {
    const access = await getAccessToken(decryptToken(String(connection.encryptedRefreshToken)));
    type ListResult = { messages?: { id: string; threadId: string }[]; resultSizeEstimate?: number };
    const search = (q: string, max: number) => gmailApi<ListResult>(access, "messages?q=" + encodeURIComponent(q) + `&maxResults=${max}`);
    // Referral emails get their own query so busy inboxes can't push them out of the general 100.
    const [general, referralList] = await Promise.all([
      search('newer_than:180d {application referral interview recruiter hiring "position filled"}', 100),
      search('newer_than:180d -in:sent {referred referral}', 50)
    ]);
    const listed = [...new Map([...(general.messages || []), ...(referralList.messages || [])].map((m) => [m.id, m])).values()];
    const jobs = await db.collection("jobs").find({ userId, archivedAt: null }).project({ _id: 1, company: 1, title: 1, sourceUrl: 1, applicationUrl: 1, referred: 1, referredBy: 1, referralSetBy: 1, applied: 1, appliedSetBy: 1 }).toArray();
    const selfEmail = String(connection.email || "").toLowerCase();
    let processed = 0, matched = 0, needsReview = 0, referralsDetected = 0;
    for (const { id: listedId } of listed) {
      const message = await gmailApi<GmailMessage>(access, `messages/${encodeURIComponent(listedId)}?format=full`);
      const subject = header(message, "Subject").slice(0, 300); const from = header(message, "From").slice(0, 300); const date = header(message, "Date").slice(0, 150); const bodyText = `${message.snippet || ""} ${decodePart(message.payload)}`;
      if (selfEmail && parseFrom(from).email === selfEmail) continue; // your own sent mail is never evidence
      const referral = detectReferral(subject, bodyText, from, jobs.map((j) => String(j.company || "")));
      const event = referral
        ? { type: "REFERRAL_REPORTED", confidence: referral.source === "SYSTEM_EMAIL" ? "HIGH" : "MEDIUM", label: referral.source === "SYSTEM_EMAIL" ? "Referral confirmed by employer" : "Referral reported by contact" }
        : classify(subject, bodyText);
      if (!event) continue;
      const lower = `${subject} ${bodyText}`.toLowerCase();
      const companyCounts = new Map<string, number>();
      for (const candidate of jobs) {
        const key = String(candidate.company || "").trim().toLowerCase();
        if (key.length >= 3) companyCounts.set(key, (companyCounts.get(key) || 0) + 1);
      }
      const matches = jobs.filter((job) => {
        const company = String(job.company || "").trim().toLowerCase();
        const title = String(job.title || "").trim().toLowerCase();
        const companyMatch = company.length >= 3 && lower.includes(company);
        const titleMatch = title.length >= 5 && lower.includes(title);
        // A unique company match is useful when automated emails omit the role title.
        // If multiple jobs at that company exist, require the role title to avoid false assignment.
        const uniqueCompanyMatch = companyMatch && companyCounts.get(company) === 1;
        let urlMatch = false;
        try {
          const host = new URL(String(job.sourceUrl)).hostname.replace(/^www\./, "").toLowerCase();
          urlMatch = host.length > 4 && lower.includes(host);
        } catch {}
        return (companyMatch && titleMatch) || (uniqueCompanyMatch && (matchesGeneric(event.type) || event.type === "REFERRAL_REPORTED")) || urlMatch;
      });
      const job = matches.length === 1 ? matches[0] : null;
      const eventDoc = { userId, messageId: message.id, threadId: message.threadId || "", subject, from, emailDate: date ? new Date(date) : (message.internalDate ? new Date(Number(message.internalDate)) : null), type: event.type, label: event.label, confidence: job ? event.confidence : "LOW", jobId: job?._id || null, matchedJob: Boolean(job), needsReview: !job, snippet: String(message.snippet || "").slice(0, 500), processedAt: new Date() };
      await db.collection("gmailEvents").updateOne({ userId, messageId: message.id }, { $set: eventDoc }, { upsert: true }); processed++;
      if (!job) { needsReview++; continue; } matched++;
      const update: Record<string, unknown> = { lastEmailEvidenceAt: eventDoc.emailDate || new Date(), lastEmailEvidenceType: event.type, lastEmailEvidenceId: message.id, updatedAt: new Date() };
      if (event.type === "APPLICATION_SUBMITTED") update.emailDetectedApplicationStatus = "SUBMITTED";
      if (event.type === "APPLICATION_REJECTED") update.emailDetectedApplicationStatus = "REJECTED";
      if (event.type === "INTERVIEW_UPDATE") update.emailDetectedApplicationStatus = "INTERVIEW";
      if (event.type === "REFERRAL_REPORTED" && !referral) update.emailDetectedReferralStatus = "REPORTED_BY_EMAIL";
      // A confirmation, interview or rejection means you applied: move the job to "Applied" unless you switched it off yourself.
      if (["APPLICATION_SUBMITTED", "INTERVIEW_UPDATE", "APPLICATION_REJECTED"].includes(event.type) && job.applied !== true && !(job.appliedSetBy === "USER" && job.applied === false)) {
        Object.assign(update, { applied: true, appliedSetBy: "EMAIL", appliedAt: eventDoc.emailDate || new Date() });
        job.applied = true;
      }
      if (referral) {
        // Switch "Got referral" on unless you switched it off yourself; fill a missing name either way.
        const userTurnedOff = job.referralSetBy === "USER" && !job.referred;
        if (!job.referred && !userTurnedOff) {
          Object.assign(update, { referred: true, referredBy: referral.referrerName, referredAt: eventDoc.emailDate || new Date(), referralSource: referral.source, referralSetBy: "EMAIL" });
          referralsDetected++;
        } else if (job.referred && !job.referredBy && referral.referrerName) {
          update.referredBy = referral.referrerName;
        }
        Object.assign(job, { referred: update.referred ?? job.referred, referredBy: update.referredBy ?? job.referredBy }); // later emails this sync see it
      }
      await db.collection("jobs").updateOne({ _id: job._id, userId }, { $set: update });
    }
    await db.collection("gmailConnections").updateOne({ _id: connection._id }, { $set: { lastSyncedAt: new Date(), lastSyncStatus: "SUCCESS" } });
    return NextResponse.json({ ok: true, messagesProcessed: processed, matchedJobs: matched, needsReview, referralsDetected, note: "Email classification is evidence-based and may require review; detected statuses do not overwrite your manually maintained application status." });
  } catch (error) {
    await db.collection("gmailConnections").updateOne({ _id: connection._id }, { $set: { lastSyncStatus: "FAILED", lastSyncError: error instanceof Error ? error.message.slice(0, 250) : "Sync failed", lastSyncAttemptAt: new Date() } });
    return jsonError(error instanceof Error ? error.message : "Gmail sync failed.", 502);
  }
}
function matchesGeneric(type: string) { return ["APPLICATION_SUBMITTED", "APPLICATION_REJECTED", "INTERVIEW_UPDATE", "APPLICATION_UPDATE", "JOB_CLOSED_NOTICE"].includes(type); }
