import "server-only";
import type { Db, Document, WithId } from "mongodb";
import { decryptToken, getAccessToken, gmailApi } from "@/lib/integrations/google-gmail";
import { detectReferral, parseFrom } from "@/lib/referral-email";
import { classify, extractVerification } from "@/lib/email-classify";

type Header = { name: string; value: string };
type GmailMessage = { id: string; threadId?: string; snippet?: string; internalDate?: string; payload?: { headers?: Header[]; mimeType?: string; body?: { data?: string }; parts?: GmailMessage["payload"][] } };
function rawPart(payload?: GmailMessage["payload"]): string {
  if (!payload) return ""; let result = "";
  if (payload.body?.data) { try { result += Buffer.from(payload.body.data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"); } catch {} }
  for (const part of payload.parts || []) result += "\n" + rawPart(part);
  return result;
}
function decodePart(payload?: GmailMessage["payload"]): string {
  return rawPart(payload).replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").slice(0, 12000);
}
function header(message: GmailMessage, name: string) { return message.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || ""; }
// Gmail's internalDate (when it received the mail) is reliable; the Date header is sender-controlled and may not parse.
function emailDate(internalDate: string | undefined, header: string) {
  for (const d of [internalDate ? new Date(Number(internalDate)) : null, header ? new Date(header) : null]) if (d && !Number.isNaN(d.getTime())) return d;
  return null;
}
function matchesGeneric(type: string) { return ["APPLICATION_SUBMITTED", "APPLICATION_REJECTED", "INTERVIEW_UPDATE", "APPLICATION_UPDATE", "JOB_CLOSED_NOTICE", "ASSESSMENT_INVITE", "COMPLETE_APPLICATION"].includes(type); }
const ACTION_TYPES = ["ASSESSMENT_INVITE", "COMPLETE_APPLICATION"];
// A later confirmation, interview or rejection means the earlier "action needed" is done or moot.
const RESOLVES_ACTION = ["APPLICATION_SUBMITTED", "INTERVIEW_UPDATE", "APPLICATION_REJECTED"];

/** Reads recent job emails for one Gmail connection and updates matching jobs. Records success/failure on the connection. */
export async function syncGmail(db: Db, connection: WithId<Document>) {
  const userId = connection.userId;
  await db.collection("gmailConnections").updateOne({ _id: connection._id }, { $set: { lastSyncAttemptAt: new Date() } });
  try {
    const access = await getAccessToken(decryptToken(String(connection.encryptedRefreshToken)));
    type ListResult = { messages?: { id: string; threadId: string }[]; resultSizeEstimate?: number };
    const search = (q: string, max: number) => gmailApi<ListResult>(access, "messages?q=" + encodeURIComponent(q) + `&maxResults=${max}`);
    // Referral emails get their own query so busy inboxes can't push them out of the general 100.
    const [general, referralList] = await Promise.all([
      search('newer_than:180d {application referral interview recruiter hiring "position filled" assessment hackerrank codility codesignal}', 100),
      search('newer_than:180d -in:sent {referred referral}', 50)
    ]);
    const listed = [...new Map([...(general.messages || []), ...(referralList.messages || [])].map((m) => [m.id, m])).values()];
    // Fetch 10 at a time: far faster than one by one, well under Gmail's per-user rate limit.
    // A message that fails (deleted mid-sync, transient 5xx) is skipped, not fatal to the whole sync.
    const messages: GmailMessage[] = [];
    for (let i = 0; i < listed.length; i += 10) {
      const results = await Promise.allSettled(listed.slice(i, i + 10).map((m) => gmailApi<GmailMessage>(access, `messages/${encodeURIComponent(m.id)}?format=full`)));
      for (const result of results) if (result.status === "fulfilled") messages.push(result.value);
    }
    if (listed.length && !messages.length) throw new Error("Could not read any Gmail messages.");
    // Oldest first, so when several emails touch the same job the newest one's status wins.
    messages.sort((a, b) => Number(a.internalDate || 0) - Number(b.internalDate || 0));
    const jobs = await db.collection("jobs").find({ userId, archivedAt: null }).project({ _id: 1, company: 1, title: 1, sourceUrl: 1, applicationUrl: 1, referred: 1, referredBy: 1, referralSetBy: 1, applied: 1, appliedSetBy: 1, actionNeeded: 1 }).toArray();
    const selfEmail = String(connection.email || "").toLowerCase();
    let processed = 0, matched = 0, needsReview = 0, referralsDetected = 0;
    for (const message of messages) {
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
      const eventDoc = { userId, messageId: message.id, threadId: message.threadId || "", subject, from, emailDate: emailDate(message.internalDate, date), type: event.type, label: event.label, confidence: job ? event.confidence : "LOW", jobId: job?._id || null, matchedJob: Boolean(job), needsReview: !job, snippet: String(message.snippet || "").slice(0, 500), processedAt: new Date() };
      await db.collection("gmailEvents").updateOne({ userId, messageId: message.id }, { $set: eventDoc }, { upsert: true }); processed++;
      if (!job) { needsReview++; continue; } matched++;
      const update: Record<string, unknown> = { lastEmailEvidenceAt: eventDoc.emailDate || new Date(), lastEmailEvidenceType: event.type, lastEmailEvidenceId: message.id, updatedAt: new Date() };
      if (event.type === "APPLICATION_SUBMITTED") update.emailDetectedApplicationStatus = "SUBMITTED";
      if (event.type === "APPLICATION_REJECTED") update.emailDetectedApplicationStatus = "REJECTED";
      if (event.type === "INTERVIEW_UPDATE") update.emailDetectedApplicationStatus = "INTERVIEW";
      if (event.type === "REFERRAL_REPORTED" && !referral) update.emailDetectedReferralStatus = "REPORTED_BY_EMAIL";
      // An assessment or "finish your application" email puts an "Action needed" chip on the job, linked to the email.
      const unset: Record<string, ""> = {};
      if (ACTION_TYPES.includes(event.type)) {
        update.actionNeeded = { type: event.type, label: event.label, messageId: message.id, at: eventDoc.emailDate || new Date() };
        job.actionNeeded = update.actionNeeded;
      } else if (RESOLVES_ACTION.includes(event.type) && job.actionNeeded && (!eventDoc.emailDate || eventDoc.emailDate >= job.actionNeeded.at)) {
        unset.actionNeeded = ""; job.actionNeeded = null;
      }
      // A confirmation, assessment, interview or rejection means you applied: move the job to "Applied" unless you switched it off yourself.
      if (["APPLICATION_SUBMITTED", "ASSESSMENT_INVITE", "INTERVIEW_UPDATE", "APPLICATION_REJECTED"].includes(event.type) && job.applied !== true && !(job.appliedSetBy === "USER" && job.applied === false)) {
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
      await db.collection("jobs").updateOne({ _id: job._id, userId }, { $set: update, ...(Object.keys(unset).length ? { $unset: unset } : {}) });
    }
    await db.collection("gmailConnections").updateOne({ _id: connection._id }, { $set: { lastSyncedAt: new Date(), lastSyncStatus: "SUCCESS" } });
    return { messagesProcessed: processed, matchedJobs: matched, needsReview, referralsDetected };
  } catch (error) {
    await db.collection("gmailConnections").updateOne({ _id: connection._id }, { $set: { lastSyncStatus: "FAILED", lastSyncError: error instanceof Error ? error.message.slice(0, 250) : "Sync failed" } });
    throw error;
  }
}

/**
 * The newest verification code or link emailed in the last 20 minutes (read-only), for the extension to
 * offer while you create an account on an application site. Emails mentioning the site are preferred.
 */
export async function findVerification(connection: WithId<Document>, siteHost: string) {
  const access = await getAccessToken(decryptToken(String(connection.encryptedRefreshToken)));
  const list = await gmailApi<{ messages?: { id: string }[] }>(access, "messages?q=" + encodeURIComponent("newer_than:1d {verify verification code otp passcode confirm activate}") + "&maxResults=10");
  const since = Date.now() - 20 * 60 * 1000;
  const messages = (await Promise.allSettled((list.messages || []).map((m) => gmailApi<GmailMessage>(access, `messages/${encodeURIComponent(m.id)}?format=full`))))
    .flatMap((r) => (r.status === "fulfilled" && Number(r.value.internalDate || 0) >= since ? [r.value] : []))
    .sort((a, b) => Number(b.internalDate || 0) - Number(a.internalDate || 0));
  // "abcfinancial.wd5.myworkdayjobs.com" → ["abcfinancial", "myworkdayjobs"]: words that tie an email to this site.
  const siteWords = siteHost.toLowerCase().split(".").filter((w) => w.length >= 4 && !/^(www|jobs|careers|apply|boards|com|wd\d+)$/.test(w));
  const found = messages.map((message) => {
    const raw = rawPart(message.payload);
    const links = [...raw.matchAll(/href=["'](https:\/\/[^"']+)["']/gi)].map((m) => m[1].replace(/&amp;/g, "&"));
    const subject = header(message, "Subject"); const from = header(message, "From");
    const result = extractVerification(subject, `${message.snippet || ""} ${decodePart(message.payload)}`, links);
    const relevant = siteWords.some((w) => `${from} ${subject} ${raw}`.toLowerCase().includes(w));
    return result && { ...result, from: parseFrom(from).email || from, subject: subject.slice(0, 200), receivedAt: new Date(Number(message.internalDate)).toISOString(), relevant };
  }).filter((x) => x !== null);
  return found.find((f) => f.relevant) ?? found[0] ?? null;
}
