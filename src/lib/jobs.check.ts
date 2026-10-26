// Self-check for extractJobDetails: run with `npx tsx src/lib/jobs.check.ts`.
import assert from "node:assert/strict";
import { extractJobDetails, jobTab } from "./jobs";

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
console.log("extractJobDetails: all checks passed");
