import { MongoClient, type Db } from "mongodb";
import { getEnv } from "@/lib/env";

const globalForMongo = globalThis as unknown as {
  mongoClientPromise?: Promise<MongoClient>;
};

function createClient() {
  const { MONGODB_URI } = getEnv();
  const client = new MongoClient(MONGODB_URI, {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 10_000
  });
  return client.connect();
}

export async function getDb(): Promise<Db> {
  const { MONGODB_DB_NAME } = getEnv();
  // Connect on first use, not at import: `next build` imports every route, and a
  // connection opened there can hang the build when the database isn't reachable.
  const client = await (globalForMongo.mongoClientPromise ??= createClient().catch((error) => {
    globalForMongo.mongoClientPromise = undefined; // let the next request retry instead of caching the failure
    throw error;
  }));
  const db = client.db(MONGODB_DB_NAME);

  // Index creation is idempotent. A production migration process can replace
  // this on larger deployments; for this starter it keeps setup straightforward.
  await Promise.all([
    db.collection("users").createIndex({ normalizedEmail: 1 }, { unique: true }),
    db.collection("sessions").createIndex({ tokenHash: 1 }, { unique: true }),
    db.collection("sessions").createIndex({ userId: 1 }),
    db.collection("sessions").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    db.collection("users").createIndex({ createdAt: -1 }),
    db.collection("jobs").createIndex(
      { userId: 1, normalizedSourceUrl: 1 },
      { unique: true, partialFilterExpression: { normalizedSourceUrl: { $type: "string" }, archivedAt: null } }
    ),
    db.collection("jobs").createIndex({ userId: 1, archivedAt: 1, createdAt: -1 }),
    db.collection("jobs").createIndex({ userId: 1, deadlineAt: 1 }),
    db.collection("referralContacts").createIndex({ userId: 1, normalizedEmail: 1 }),
    db.collection("referralContacts").createIndex({ userId: 1, createdAt: -1 }),
    db.collection("jobReferrers").createIndex({ userId: 1, jobId: 1, contactId: 1 }, { unique: true }),
    db.collection("jobReferrers").createIndex({ userId: 1, jobId: 1, createdAt: -1 }),
    db.collection("referralEvents").createIndex({ userId: 1, jobId: 1, referrerId: 1, createdAt: -1 }),    db.collection("oauthStates").createIndex({ state: 1 }, { unique: true }),
    db.collection("oauthStates").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    db.collection("gmailConnections").createIndex({ userId: 1 }, { unique: true }),
    db.collection("gmailEvents").createIndex({ userId: 1, messageId: 1 }, { unique: true }),
    db.collection("gmailEvents").createIndex({ userId: 1, needsReview: 1, processedAt: -1 }),
    db.collection("availabilityChecks").createIndex({ userId: 1, jobId: 1, checkedAt: -1 })
  ]);

  return db;
}
