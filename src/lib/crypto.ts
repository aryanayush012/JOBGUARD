import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// ponytail: one AES key for every secret at rest (Gmail tokens, resumes, answer banks); split keys if the threat model needs it.
function key() {
  const encryptionKey = Buffer.from(process.env.GMAIL_TOKEN_ENCRYPTION_KEY || "", "base64");
  if (encryptionKey.length !== 32) throw new Error("GMAIL_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
  return encryptionKey;
}

/** AES-256-GCM. Output: "iv.tag.ciphertext", each base64url. */
export function encrypt(plain: string | Buffer) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(typeof plain === "string" ? Buffer.from(plain, "utf8") : plain), cipher.final()]);
  return [iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptBuffer(value: string) {
  const [iv, tag, encrypted] = value.split(".");
  if (!iv || !tag || !encrypted) throw new Error("Stored encrypted value is invalid.");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]);
}

export function decrypt(value: string) { return decryptBuffer(value).toString("utf8"); }
