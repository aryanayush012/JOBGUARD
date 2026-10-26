import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { hasTrustedOrigin, jsonError } from "@/lib/http";
import { extractJobDetails } from "@/lib/jobs";
import { fetchPublicPage } from "@/lib/public-fetch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Best-effort company/title for a pasted job URL, so the form can prefill them. Empty strings = not found. */
export async function POST(request: Request) {
  if (!hasTrustedOrigin(request)) return jsonError("Invalid request origin.", 403);
  if (!(await getCurrentUser())) return jsonError("Authentication required.", 401);
  const parsed = z.object({ url: z.string().trim().url().max(2048) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Enter a valid job URL.", 400);

  // The board URL alone (greenhouse/lever/ashby/workday) may already name the company.
  let details = extractJobDetails("", parsed.data.url);
  try {
    const page = await fetchPublicPage(parsed.data.url);
    if (page.status >= 200 && page.status < 300) {
      const fromPage = extractJobDetails(page.html, parsed.data.url);
      details = { company: fromPage.company || details.company, title: fromPage.title };
    }
  } catch { /* blocked, private, timed out, or not HTML: fall back to the URL-only result */ }
  return NextResponse.json(details);
}
