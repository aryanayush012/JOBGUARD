// Self-check for computeAnalytics: run with `npx tsx src/lib/analytics.check.ts`.
import assert from "node:assert/strict";
import { computeAnalytics } from "./analytics";

const now = new Date("2026-11-06T00:00:00Z");
const past = new Date("2026-11-01T00:00:00Z"), future = new Date("2026-11-20T00:00:00Z");
const a = computeAnalytics([
  { _id: "1", company: "Cohesity", referred: true, referredBy: "Aditi", applied: true, deadlineAt: past },  // applied wins over missed
  { _id: "2", company: "Cisco", deadlineAt: past },                                                     // missed
  { _id: "3", company: "Amgen", referred: true, deadlineAt: past },                                     // missed · referred, no name
  { _id: "4", company: "Acme", deadlineAt: future },                                                    // not applied
  { _id: "5", company: "Acme", referredBy: "ignored when not referred", deadlineAt: future }            // stale name doesn't count
], new Map([["4", ["Ravi", "ravi "]]]), now);                                                            // submitted via referral manager, deduped

assert.deepEqual(a.counts, { "applied-referred": 1, referred: 1, "not-applied": 1, "missed-referred": 1, missed: 1, applied: 0 });
assert.deepEqual(a.jobs.map((j) => j.segment), ["applied-referred", "missed", "missed-referred", "referred", "not-applied"]);
assert.deepEqual(a.links, [
  { referrer: "Aditi", company: "Cohesity", jobId: "1" },
  { referrer: "Unnamed referrer", company: "Amgen", jobId: "3" },
  { referrer: "Ravi", company: "Acme", jobId: "4" }
]);
assert.deepEqual(a.totals, { jobs: 5, referred: 3, applied: 1, missed: 2, open: 2, referrers: 3, companies: 3 });
// Every job lands in exactly one segment
assert.equal(Object.values(a.counts).reduce((x, y) => x + y, 0), a.jobs.length);
console.log("computeAnalytics: all checks passed");
