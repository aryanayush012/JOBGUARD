// Self-check for detectReferral: run with `npx tsx src/lib/referral-email.check.ts`.
import assert from "node:assert/strict";
import { detectReferral } from "./referral-email";

const ats = "Greenhouse <no-reply@us.greenhouse-mail.io>";

// Employer/ATS confirmations
assert.deepEqual(detectReferral("You've been referred to Stripe", "Hi Ayush, Priya Sharma has referred you for the Software Engineer role at Stripe.", ats),
  { source: "SYSTEM_EMAIL", referrerName: "Priya Sharma", referrerEmail: "" });
assert.deepEqual(detectReferral("Referral for Data Analyst", "Great news! You were referred by Rahul K. Mehta. Complete your application.", "Workday <workday@myworkday.com>"),
  { source: "SYSTEM_EMAIL", referrerName: "Rahul K. Mehta", referrerEmail: "" });
// Real Workday email: words between "referred" and "by <Name>", company excluded
assert.equal(detectReferral("You have been referred", "Hi Ayush Aryan , We have some great news for you... You have been referred to a job at Cohesity by Aditi Bodake as they think you&#39;d be a great fit to join the team!", "noreply workday <cohesity@myworkday.com>", ["cohesity"])?.referrerName, "Aditi Bodake");
// Quoted name
assert.equal(detectReferral("Referral", `You have been referred by "Neha Gupta" for the role.`, ats)?.referrerName, "Neha Gupta");
// "by <Company>" alone must not become the referrer
assert.equal(detectReferral("Referral", "You have been referred to a job by Cohesity.", ats, ["Cohesity"])?.referrerName, "");
// "<Name> at <Company> has referred you": the company must not become the referrer
assert.equal(detectReferral("Referral", "Anita Rao at Globex has referred you for a role.", ats, ["Globex"])?.referrerName, "");
// System email with no name
assert.deepEqual(detectReferral("You have been referred", "An employee has referred you for an open position.", ats),
  { source: "SYSTEM_EMAIL", referrerName: "", referrerEmail: "" });

// The person themselves saying they did it: reported, not confirmed
assert.deepEqual(detectReferral("Re: Referral for SDE-2", "Hey! I've referred you, you should get an email soon.", "Priya Sharma <priya.sharma@gmail.com>"),
  { source: "CONTACT_EMAIL", referrerName: "Priya Sharma", referrerEmail: "priya.sharma@gmail.com" });

// Must NOT trigger: promises, asks, marketing
assert.equal(detectReferral("Re: Referral", "Sure, I will refer you once you send your resume.", "Priya <priya@gmail.com>"), null);
assert.equal(detectReferral("Referral request", "Could you please refer me for the SDE role?", "Me <me@gmail.com>"), null);
assert.equal(detectReferral("Refer a friend and earn ₹10,000", "Our referral bonus program is live!", "Jobs <jobs@naukri.com>"), null);
assert.equal(detectReferral("Application received", "Were you referred by an employee? Let us know.", ats), null);
console.log("detectReferral: all checks passed");
