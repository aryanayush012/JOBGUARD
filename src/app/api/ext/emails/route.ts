import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getUserFromBearer } from "@/lib/auth";
import { getDb } from "@/lib/mongodb";
import { jsonError } from "@/lib/http";
import { getSettings } from "@/lib/settings";
import { loadJobsForEmail, processEmail } from "@/lib/gmail-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  emails: z.array(z.object({
    key: z.string().min(1).max(200), from: z.string().max(300), subject: z.string().max(300),
    snippet: z.string().max(500), date: z.string().max(40).optional()
  })).min(1).max(50)
});

/**
 * Job emails spotted by the extension in your Gmail. It sends only emails that mention one of your saved companies
 * and look job-related, and only their subject, preview line, sender and date (never the body). Emails that
 * don't match a saved job are discarded, not stored.
 */
export async function POST(request: Request) {
  const user = await getUserFromBearer(request);
  if (!user) return jsonError("Token invalid or disconnected.", 401);
  const db = await getDb(); const userId = new ObjectId(user.id);
  if (!(await getSettings(db, userId)).emailScan) return jsonError("Email updates are turned off on your Profile page.", 403);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Invalid email data.", 400);

  const ctx = { userId, jobs: await loadJobsForEmail(db, userId), selfEmail: user.email.toLowerCase(), keepUnmatched: false };
  const emails = parsed.data.emails.map((e) => {
    const date = e.date ? new Date(e.date) : null;
    // Stable id per Gmail message, namespaced so it never collides with server-side sync ids.
    return { id: `ext:${createHash("sha256").update(`${e.key}|${e.subject}`).digest("hex").slice(0, 24)}`, threadId: /^[0-9a-f]{12,20}$/i.test(e.key) ? e.key : "", subject: e.subject, from: e.from, date: date && !Number.isNaN(date.getTime()) ? date : null, text: e.snippet, snippet: e.snippet };
  }).sort((a, b) => (a.date?.getTime() ?? 0) - (b.date?.getTime() ?? 0)); // oldest first, newest status wins

  let matched = 0;
  for (const email of emails) if ((await processEmail(db, ctx, email)).startsWith("matched")) matched++;
  return NextResponse.json({ received: emails.length, matched });
}
