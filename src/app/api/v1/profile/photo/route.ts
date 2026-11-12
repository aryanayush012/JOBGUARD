import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/mongodb";
import { hasTrustedOrigin, jsonError } from "@/lib/http";
import { loadPhotoFile, savePhoto } from "@/lib/profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 2 * 1024 * 1024;
// Identify the image by its bytes, not its name or the browser's claim.
function imageType(b: Buffer) {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}

/** Upload or replace your photo (JPG, PNG or WebP, up to 2 MB), for applications that ask for one. */
export async function POST(request: Request) {
  if (!hasTrustedOrigin(request)) return jsonError("Invalid request origin.", 403);
  const user = await getCurrentUser();
  if (!user) return jsonError("Authentication required.", 401);
  const file = (await request.formData().catch(() => null))?.get("photo");
  if (!(file instanceof File)) return jsonError("Choose an image to upload.", 400);
  if (file.size > MAX_BYTES) return jsonError("Photo must be 2 MB or smaller.", 400);
  const image = Buffer.from(await file.arrayBuffer());
  const mime = imageType(image);
  if (!mime) return jsonError("Photo must be a JPG, PNG or WebP image.", 400);
  await savePhoto(await getDb(), new ObjectId(user.id), mime, image);
  return NextResponse.json({ ok: true });
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return jsonError("Authentication required.", 401);
  const photo = await loadPhotoFile(await getDb(), new ObjectId(user.id));
  if (!photo) return jsonError("No photo uploaded.", 404);
  return new NextResponse(new Uint8Array(photo.image), { headers: { "content-type": photo.mime, "cache-control": "private, no-store" } });
}

export async function DELETE(request: Request) {
  if (!hasTrustedOrigin(request)) return jsonError("Invalid request origin.", 403);
  const user = await getCurrentUser();
  if (!user) return jsonError("Authentication required.", 401);
  await savePhoto(await getDb(), new ObjectId(user.id), "", null);
  return NextResponse.json({ ok: true });
}
