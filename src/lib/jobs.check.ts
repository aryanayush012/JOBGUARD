// Self-check for extractJobDetails: run with `npx tsx src/lib/jobs.check.ts`.
import assert from "node:assert/strict";
import { assessAvailability, estimateDeadline, extractJobDetails, jobTab } from "./jobs";

// Tabs: applied beats referred beats not applied; old jobs fall back to the Gmail-detected status
assert.equal(jobTab({}), "not-applied");
assert.equal(jobTab({ referred: true }), "referred");
assert.equal(jobTab({ referred: true, applied: true }), "applied");
assert.equal(jobTab({ emailDetectedApplicationStatus: "SUBMITTED" }), "applied");
assert.equal(jobTab({ emailDetectedApplicationStatus: "SUBMITTED", applied: false }), "not-applied"); // you switched it off
assert.equal(jobTab({ emailDetectedApplicationStatus: "SUBMITTED", applied: false, referred: true }), "referred");

const ld = (obj: unknown) => `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;

// Plain JobPosting, with HTML entities in the values
assert.deepEqual(
  extractJobDetails(ld({ "@type": "JobPosting", title: "Senior Engineer &amp; Lead", hiringOrganization: { "@type": "Organization", name: "Acme &amp; Co" } }), "https://acme.com/jobs/1"),
  { company: "Acme & Co", title: "Senior Engineer & Lead" }
);
// Inside @graph, with @type as an array and the org as a plain string
assert.deepEqual(
  extractJobDetails(ld({ "@graph": [{ "@type": "WebPage" }, { "@type": ["JobPosting"], title: "Data Analyst", hiringOrganization: "Globex" }] }), "https://x.com/j"),
  { company: "Globex", title: "Data Analyst" }
);
// Malformed JSON-LD followed by a valid block
assert.deepEqual(
  extractJobDetails(`<script type="application/ld+json">{bad</script>` + ld({ "@type": "JobPosting", title: "PM" }), "https://boards.greenhouse.io/initech/jobs/1"),
  { company: "initech", title: "PM" }
);
// No JSON-LD: company from board URL only, title stays blank (no guessing)
assert.deepEqual(extractJobDetails("<title>Engineer at Foo</title>", "https://jobs.lever.co/foo-bar/abc"), { company: "foo bar", title: "" });
assert.deepEqual(extractJobDetails("", "https://wayne.wd5.myworkdayjobs.com/en-US/careers/job/1"), { company: "wayne", title: "" });
// Unknown site, nothing found
assert.deepEqual(extractJobDetails("<html></html>", "https://example.com/careers/1"), { company: "", title: "" });
// Deadline: validThrough wins; else earlier of today+5 and posted+30
const now = new Date("2026-10-28T00:00:00Z");
const day = 24 * 60 * 60 * 1000;
assert.deepEqual(estimateDeadline(ld({ "@type": "JobPosting", validThrough: "2026-12-01T00:00:00Z", datePosted: "2026-10-01" }), now), { deadlineAt: new Date("2026-12-01T00:00:00Z"), deadlineConfidence: "VERIFIED" });
assert.deepEqual(estimateDeadline(ld({ "@type": "JobPosting", datePosted: "2026-10-20T00:00:00Z" }), now), { deadlineAt: new Date(now.getTime() + 5 * day), deadlineConfidence: "ESTIMATED" }); // fresh posting: apply early
assert.deepEqual(estimateDeadline(ld({ "@type": "JobPosting", datePosted: "2026-09-30T00:00:00Z" }), now), { deadlineAt: new Date("2026-10-30T00:00:00Z"), deadlineConfidence: "ESTIMATED" }); // 30-day window ends sooner
assert.deepEqual(estimateDeadline("", now), { deadlineAt: new Date(now.getTime() + 5 * day), deadlineConfidence: "ESTIMATED" });
assert.deepEqual(estimateDeadline(ld({ "@type": "JobPosting", validThrough: "not a date" }), now).deadlineConfidence, "ESTIMATED");
// Availability: JS-rendered page with JobPosting data counts as open; without it stays unknown
assert.equal(assessAvailability(200, "", ld({ "@type": "JobPosting", title: "Dev" })).availabilityStatus, "OPEN");
assert.equal(assessAvailability(200, "", "<html></html>").availabilityStatus, "UNKNOWN");
assert.equal(assessAvailability(200, "this job is no longer available", ld({ "@type": "JobPosting" })).availabilityStatus, "CLOSED");
console.log("extractJobDetails/estimateDeadline/assessAvailability: all checks passed");
