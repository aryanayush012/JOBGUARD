// Self-check for email classification: run with `npx tsx src/lib/email-classify.check.ts`.
import assert from "node:assert/strict";
import { classify, extractVerification } from "./email-classify";

const type = (subject: string, body = "") => classify(subject, body)?.type ?? null;
// Action-needed emails win over the generic "your application for" confirmation
assert.equal(type("Complete your application for Software Engineer at Acme"), "COMPLETE_APPLICATION");
assert.equal(type("Your application is incomplete"), "COMPLETE_APPLICATION");
assert.equal(type("Acme: Online Assessment for your application for Frontend Engineer"), "ASSESSMENT_INVITE");
assert.equal(type("Invitation", "You've been invited to take a HackerRank test"), "ASSESSMENT_INVITE");
assert.equal(type("Next step", "Please complete the Codility coding challenge within 7 days"), "ASSESSMENT_INVITE");
// Existing types still work
assert.equal(type("Thank you for applying to Acme"), "APPLICATION_SUBMITTED");
assert.equal(type("Your application for Frontend Engineer"), "APPLICATION_SUBMITTED");
assert.equal(type("Update", "We regret to inform you that we will not be moving forward"), "APPLICATION_REJECTED");
assert.equal(type("Interview invitation: Frontend Engineer"), "INTERVIEW_UPDATE");
assert.equal(type("Your weekly newsletter"), null);

// Verification codes and links
assert.deepEqual(extractVerification("Verify your email", "Your verification code is 482913. It expires in 10 minutes."), { code: "482913", link: null });
assert.deepEqual(extractVerification("Workday account", "482913 is your one-time passcode"), { code: "482913", link: null });
assert.deepEqual(extractVerification("Confirm your account", "Click below to verify", ["https://x.myworkdayjobs.com/verify?t=abc", "https://x.com/privacy"]), { code: null, link: "https://x.myworkdayjobs.com/verify?t=abc" });
assert.equal(extractVerification("Your verification code", "Copyright 2026 Acme")?.code ?? null, null); // a year is not a code
assert.equal(extractVerification("Verify", "Your code expires in 10 minutes. Code: 4F7K2Q")?.code, "4F7K2Q");      // "expires" is not a code
assert.equal(extractVerification("Security code", "Your OTP: 9921")?.code, "9921");
assert.equal(extractVerification("Thank you for applying", "Ref 123456"), null);                         // not a verification email
console.log("email classification: all checks passed");
