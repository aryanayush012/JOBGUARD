import "server-only";
import type { Db, ObjectId } from "mongodb";

/**
 * Per-user privacy & automation choices, managed on the Profile page and read by the extension.
 * Defaults favour privacy: anything that sends data to a third party (AI) starts off.
 */
export type UserSettings = { autoFill: boolean; emailScan: boolean; aiAssist: boolean };
export const DEFAULT_SETTINGS: UserSettings = { autoFill: true, emailScan: true, aiAssist: false };
export const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof UserSettings)[];

export async function getSettings(db: Db, userId: ObjectId): Promise<UserSettings> {
  const user = await db.collection("users").findOne({ _id: userId }, { projection: { settings: 1 } });
  const saved = (user?.settings ?? {}) as Partial<UserSettings>;
  return Object.fromEntries(SETTING_KEYS.map((k) => [k, typeof saved[k] === "boolean" ? saved[k] : DEFAULT_SETTINGS[k]])) as UserSettings;
}

export async function updateSettings(db: Db, userId: ObjectId, changes: Partial<UserSettings>) {
  const $set = Object.fromEntries(SETTING_KEYS.filter((k) => typeof changes[k] === "boolean").map((k) => [`settings.${k}`, changes[k]]));
  if (Object.keys($set).length) await db.collection("users").updateOne({ _id: userId }, { $set });
  return getSettings(db, userId);
}
