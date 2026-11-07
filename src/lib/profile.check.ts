// Self-check for the answer bank: run with `npx tsx src/lib/profile.check.ts`.
import assert from "node:assert/strict";
import { isCompanySpecific, isSensitive, matchField, mergeResume, pickOption, planAnswers, profileText, withStandardFields, type ProfileField } from "./profile-fields";

const now = new Date("2026-11-06T00:00:00Z");
const custom = (label: string, value: string, reusable = true): ProfileField =>
  ({ key: `custom-${label}`, label, group: "Saved answers", aliases: [], value, source: "USER", fromResume: false, reusable, updatedAt: null });

// Merge: resume fills empties and refreshes RESUME values; your edits always win; non-resume fields untouched
let fields = mergeResume([], { firstName: "Ayush", phone: "+91 98765 43210", noticePeriod: "should be ignored" }, now);
assert.equal(fields.find((f) => f.key === "firstName")!.value, "Ayush");
assert.equal(fields.find((f) => f.key === "noticePeriod")!.value, "");
fields = fields.map((f) => f.key === "phone" ? { ...f, value: "+91 11111 11111", source: "USER" as const } : f);
fields = mergeResume(fields, { firstName: "Ayush Aryan", phone: "+91 98765 43210" }, now);
assert.equal(fields.find((f) => f.key === "firstName")!.value, "Ayush Aryan");   // refreshed
assert.equal(fields.find((f) => f.key === "phone")!.value, "+91 11111 11111");   // your edit kept
fields = mergeResume(fields, { firstName: "" }, now);
assert.equal(fields.find((f) => f.key === "firstName")!.value, "Ayush Aryan");   // blank extraction never wipes a value
// Saved answers survive merges, after the standard fields
const withCustom = mergeResume([...fields, custom("Years of React experience", "3")], {}, now);
assert.equal(withCustom.at(-1)!.label, "Years of React experience");

// Matching form questions to answers
const bank = [...withStandardFields(fields.map((f) => ({ ...f, value: f.value || "x" }))), custom("Years of React experience", "3"), custom("Why do you want to join Google?", "…", false)];
const key = (q: string) => matchField(q, bank)?.key ?? null;
assert.equal(key("Mobile Number *"), "phone");
assert.equal(key("LinkedIn Profile URL"), "linkedin");
assert.equal(key("First Name"), "firstName");
assert.equal(key("Email address (optional)"), "email");
assert.equal(key("What is your notice period?"), "noticePeriod");
assert.equal(key("Expected salary"), "expectedCtc");
assert.equal(key("How many years of React experience do you have?"), "custom-Years of React experience");
assert.equal(key("Why do you want to join Google?"), null);                         // company-specific answers never reused
assert.equal(key("Describe a time you resolved a conflict"), null);

// Company-specific detection
assert.ok(isCompanySpecific("Why do you want to join us?"));
assert.ok(isCompanySpecific("What excites you about this role?"));
assert.ok(isCompanySpecific("How did you hear about Atlassian?", "Atlassian"));
assert.ok(!isCompanySpecific("Years of React experience"));
// Dropdown/radio option mapping
assert.equal(pickOption("Yes", ["Select…", "Yes, I am authorized", "No"]), "Yes, I am authorized");
assert.equal(pickOption("no", ["Yes", "No"]), "No");
assert.equal(pickOption("30 days", ["Immediately", "15 Days", "30 Days", "60 Days"]), "30 Days");
assert.equal(pickOption("B.Tech", ["High school", "B.Tech / B.E.", "M.Tech"]), "B.Tech / B.E.");
assert.equal(pickOption("Gurugram", ["Bengaluru", "Pune"]), null);

// Planning a form: bank answers, AI leftovers, sensitive questions skipped
const plan = planAnswers([
  { id: "a", label: "Phone number" },
  { id: "b", label: "Gender" },
  { id: "c", label: "Are you willing to relocate?", options: ["Yes", "No"] },
  { id: "d", label: "Describe your biggest project" },
  { id: "e", label: "Do you have a disability?" }
], bank.map((f) => f.key === "relocate" ? { ...f, value: "yes" } : f));
assert.deepEqual(plan.answers.map((a) => [a.id, a.key, a.value]), [["a", "phone", "+91 11111 11111"], ["c", "relocate", "Yes"]]);
assert.deepEqual(plan.unknown.map((q) => q.id), ["d"]);
assert.deepEqual(plan.skipped, ["b", "e"]);
assert.ok(isSensitive("Race/Ethnicity") && isSensitive("Veteran status") && !isSensitive("Years of experience") && !isSensitive("Stage of your career"));
// Profile text for the AI excludes other companies' "why us" answers
assert.ok(!profileText(bank).includes("Why do you want to join Google"));
console.log("profile fields: all checks passed");
