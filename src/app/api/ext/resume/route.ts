import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getUserFromBearer } from "@/lib/auth";
import { getDb } from "@/lib/mongodb";
import { jsonError } from "@/lib/http";
import { loadResumeFile } from "@/lib/profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The resume PDF, for the extension to attach to an application's upload field. */
export async function GET(request: Request) {
  const user = await getUserFromBearer(request);
  if (!user) return jsonError("Token invalid or disconnected.", 401);
  const file = await loadResumeFile(await getDb(), new ObjectId(user.id));
  if (!file) return jsonError("No resume uploaded yet. Add one on your JobGuard Profile page.", 404);
  return new NextResponse(new Uint8Array(file.pdf), { headers: { "content-type": "application/pdf", "x-file-name": encodeURIComponent(file.fileName), "cache-control": "private, no-store" } });
}
