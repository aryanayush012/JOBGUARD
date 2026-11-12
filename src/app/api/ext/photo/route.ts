import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getUserFromBearer } from "@/lib/auth";
import { getDb } from "@/lib/mongodb";
import { jsonError } from "@/lib/http";
import { loadPhotoFile } from "@/lib/profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Your photo, for the extension to attach to an application's photo field. */
export async function GET(request: Request) {
  const user = await getUserFromBearer(request);
  if (!user) return jsonError("Token invalid or disconnected.", 401);
  const photo = await loadPhotoFile(await getDb(), new ObjectId(user.id));
  if (!photo) return jsonError("No photo on your JobGuard Profile yet.", 404);
  const ext = photo.mime === "image/png" ? "png" : photo.mime === "image/webp" ? "webp" : "jpg";
  return new NextResponse(new Uint8Array(photo.image), { headers: { "content-type": photo.mime, "x-file-name": `photo.${ext}`, "cache-control": "private, no-store" } });
}
