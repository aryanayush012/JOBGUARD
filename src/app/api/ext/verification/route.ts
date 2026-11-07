import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getUserFromBearer } from "@/lib/auth";
import { getDb } from "@/lib/mongodb";
import { jsonError } from "@/lib/http";
import { findVerification } from "@/lib/gmail-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The latest verification code/link from your Gmail (last 20 minutes), for the site you're applying on. */
export async function GET(request: Request) {
  const user = await getUserFromBearer(request);
  if (!user) return jsonError("Token invalid or disconnected.", 401);
  const host = new URL(request.url).searchParams.get("host")?.slice(0, 253) || "";
  const connection = await (await getDb()).collection("gmailConnections").findOne({ userId: new ObjectId(user.id), status: "CONNECTED" });
  if (!connection?.encryptedRefreshToken) return jsonError("Connect Gmail on JobGuard to fetch verification codes.", 400);
  try {
    const found = await findVerification(connection, host);
    if (!found) return jsonError("No verification email in the last 20 minutes yet. Wait a moment and try again.", 404);
    return NextResponse.json(found);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Couldn't read Gmail.", 502);
  }
}
