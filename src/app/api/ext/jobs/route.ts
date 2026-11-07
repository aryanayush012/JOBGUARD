import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getUserFromBearer } from "@/lib/auth";
import { getDb } from "@/lib/mongodb";
import { jsonError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Your saved companies/titles, so the extension can tell job emails from everything else on your own computer. */
export async function GET(request: Request) {
  const user = await getUserFromBearer(request);
  if (!user) return jsonError("Token invalid or disconnected.", 401);
  const jobs = await (await getDb()).collection("jobs").find({ userId: new ObjectId(user.id), archivedAt: null }).project({ company: 1, title: 1 }).limit(300).toArray();
  return NextResponse.json({ jobs: jobs.map((j) => ({ company: String(j.company || ""), title: String(j.title || "") })).filter((j) => j.company) });
}
