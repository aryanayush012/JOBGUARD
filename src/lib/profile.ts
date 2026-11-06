import "server-only";
import { ObjectId, type Db } from "mongodb";
import { decrypt, decryptBuffer, encrypt } from "@/lib/crypto";
import { withStandardFields, type ProfileField } from "@/lib/profile-fields";

/** Profile storage: the resume PDF and the answer bank are encrypted at rest (they hold phone numbers, CTC, etc.). */
export type ResumeMeta = { fileName: string; size: number; uploadedAt: string } | null;

export async function loadProfile(db: Db, userId: ObjectId) {
  const doc = await db.collection("profiles").findOne({ userId }, { projection: { "resume.data": 0 } });
  const stored: ProfileField[] = doc?.fields ? JSON.parse(decrypt(String(doc.fields))) : [];
  const resume: ResumeMeta = doc?.resume ? { fileName: String(doc.resume.fileName), size: Number(doc.resume.size), uploadedAt: new Date(doc.resume.uploadedAt).toISOString() } : null;
  return { fields: withStandardFields(stored), resume };
}

export async function saveFields(db: Db, userId: ObjectId, fields: ProfileField[]) {
  // Untouched empty standard fields are implied by the catalog. Ones you cleared on purpose are kept (as yours) so a re-upload doesn't refill them.
  const keep = fields.filter((f) => f.value || f.source === "USER" || f.group === "Saved answers");
  await db.collection("profiles").updateOne({ userId }, { $set: { userId, fields: encrypt(JSON.stringify(keep)), updatedAt: new Date() } }, { upsert: true });
}

export async function saveResume(db: Db, userId: ObjectId, fileName: string, pdf: Buffer) {
  await db.collection("profiles").updateOne({ userId }, { $set: { userId, resume: { fileName, size: pdf.length, uploadedAt: new Date(), data: encrypt(pdf) }, updatedAt: new Date() } }, { upsert: true });
}

export async function loadResumeFile(db: Db, userId: ObjectId) {
  const doc = await db.collection("profiles").findOne({ userId }, { projection: { resume: 1 } });
  return doc?.resume?.data ? { fileName: String(doc.resume.fileName), pdf: decryptBuffer(String(doc.resume.data)) } : null;
}
