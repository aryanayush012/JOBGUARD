import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/mongodb";
import { hasTrustedOrigin, jsonError } from "@/lib/http";
import { loadProfile, loadResumeFile, saveFields, saveResume } from "@/lib/profile";
import { mergeResume } from "@/lib/profile-fields";
import { extractProfile, geminiConfigured } from "@/lib/gemini";
import { getSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // Gemini reading a PDF can take 10-30s

const MAX_BYTES = 4 * 1024 * 1024; // stays under Vercel's 4.5 MB request limit

/** Upload a resume PDF: stored encrypted, then read by Gemini to fill the answer bank (your edits are kept). */
export async function POST(request: Request) {
  if (!hasTrustedOrigin(request)) return jsonError("Invalid request origin.", 403);
  const user = await getCurrentUser();
  if (!user) return jsonError("Authentication required.", 401);
  const form = await request.formData().catch(() => null);
  const file = form?.get("resume");
  if (!(file instanceof File)) return jsonError("Choose a PDF file to upload.", 400);
  if (file.size > MAX_BYTES) return jsonError("Resume must be 4 MB or smaller.", 400);
  const pdf = Buffer.from(await file.arrayBuffer());
  if (pdf.subarray(0, 5).toString("latin1") !== "%PDF-") return jsonError("Resume must be a PDF.", 400); // check the bytes, not the extension

  const db = await getDb(); const userId = new ObjectId(user.id);
  const fileName = file.name.replace(/[^\w.\- ()]+/g, "_").slice(0, 120) || "resume.pdf";
  await saveResume(db, userId, fileName, pdf);

  let warning: string | undefined;
  const { aiAssist } = await getSettings(db, userId);
  if (!aiAssist) {
    warning = "Resume saved. AI assist is off, so your resume wasn't read automatically: turn on AI assist above, or fill the answers yourself.";
  } else if (geminiConfigured()) {
    try {
      const { fields } = await loadProfile(db, userId);
      await saveFields(db, userId, mergeResume(fields, await extractProfile(pdf)));
    } catch (error) {
      warning = `Resume saved, but it couldn't be read automatically (${error instanceof Error ? error.message : "AI error"}). You can fill the fields yourself.`;
    }
  } else {
    warning = "Resume saved. Automatic reading is off on this server (no GEMINI_API_KEY), so fill the fields yourself.";
  }
  return NextResponse.json({ ...(await loadProfile(db, userId)), warning });
}

/** Download your own resume. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return jsonError("Authentication required.", 401);
  const file = await loadResumeFile(await getDb(), new ObjectId(user.id));
  if (!file) return jsonError("No resume uploaded.", 404);
  return new NextResponse(new Uint8Array(file.pdf), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${file.fileName.replace(/"/g, "")}"`, "cache-control": "private, no-store" } });
}
