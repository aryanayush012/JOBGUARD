# Job Referral & Application Protection Portal

Phase 3 local-development build of the job opportunity protection portal. Keep the project local until the remaining workflows are implemented and tested; this is not a production-ready application yet.

## Stack

- Next.js App Router + React + TypeScript
- MongoDB Atlas
- Custom email/password authentication
- Argon2id password hashing
- Opaque server-side sessions stored in MongoDB

## Included

### Foundation and job management

- Registration, login, logout, and session-check API endpoints
- Normalized unique email index; HTTP-only session cookie
- Create, list, view, edit, and archive jobs
- Manual job detail entry with source URL, application URL, employer, title, location, description, deadline, deadline confidence, and availability status
- Per-user normalized URL duplicate detection
- Ownership-scoped API and database queries

### Phase 3: referral tracking

- Add multiple potential referrers to an individual job, with name, company, email, profile URL, and notes
- Configure a per-job referral wait window from 1 to 168 hours (default: 48 hours)
- Manually record outreach sent, generic reply, referral promised, referral actually submitted, no response, declined, and free-form note events
- Timestamped outreach history for each potential referrer
- Timer starts only on the first logged outreach sent; later messages, generic replies, and promises do not reset it
- Promised referral and actual submitted referral are separate states and timestamps
- State-changing routes validate request origin and all referral records are scoped to the authenticated user

Automatic job-page metadata extraction is not included yet; manual entry is the reliable fallback. There is no LinkedIn integration or automatic outreach.

## Test Phase 3 locally

1. Start the app and sign in.
2. Open a saved job from the dashboard.
3. Add two potential referrers in the **Referral tracking** section.
4. Set the referral wait window to 24 hours and click **Save wait window**.
5. For one referrer, log **Outreach sent**. Verify the first-contact timestamp and window expiry appear.
6. Log **Generic reply received**, then **Referral promised**. Verify that the first-contact timestamp and window expiry do not change.
7. Only after independently verifying it happened, log **Referral actually submitted**. Confirm the event history distinguishes it from a promise.
8. Refresh the page and verify records and event history persist.
9. Try to access the same job while signed in as another account; its referral records should not be visible or modifiable.

The referral timer's expiry is stored, but background deadline processing, reminders, and email notifications are not implemented yet. Those are planned for a later phase. No application is submitted automatically.

## Requirements

- Node.js 20.9+
- MongoDB Atlas cluster and database user
- Git and a GitHub account for later deployment

## Run locally

1. Extract the ZIP and open the project directory.
2. Install dependencies:

   ```bash
   npm install
   ```

3. Copy `.env.example` to `.env.local` and fill in the MongoDB connection details and a strong session secret.
4. Start the development server:

   ```bash
   npm run dev
   ```

5. Visit `http://localhost:3000`.

Useful checks after installing dependencies:

```bash
npm run typecheck
npm run lint
npm run build
```

## MongoDB Atlas setup

1. Create a free cluster if your account and region currently offer one.
2. Create a database user with a strong password.
3. Configure network access. For local development, allow your current public IP where possible; do not open access to the entire internet unless you understand the risk and have a reason.
4. Copy the application connection string into `MONGODB_URI`.
5. Never commit `.env.local` or credentials to Git.

The application creates its required indexes when the database module first connects.

## Later deployment

Deployment is intentionally deferred until the remaining features are implemented and tested. The eventual web hosting target is Vercel, with MongoDB Atlas for persistence. A persistent deadline/reminder mechanism must be selected and tested before deployment; it must not rely on a browser tab remaining open. Confirm all hosting free-tier eligibility, limits, and terms at deployment time.

## Security notes

- Passwords are never stored in plain text.
- Session tokens are random and only their hashes are stored in MongoDB.
- Session cookies are HTTP-only and Secure in production.
- State-changing APIs validate request origin and verify authentication.
- User-owned resources are queried with the authenticated user ID.
- Login and registration do not yet have a distributed rate limiter. Add rate limiting, account recovery, email verification, and broader security testing before production use.

## Phase 4: Gmail evidence sync and public job availability checks

### Gmail OAuth setup (optional until configured)

1. In Google Cloud Console, create/select a project, enable the Gmail API, and configure the OAuth consent screen.
2. Create a **Web application** OAuth client.
3. Add the exact redirect URI `${APP_BASE_URL}/api/integrations/gmail/callback` (for local development: `http://localhost:3000/api/integrations/gmail/callback`).
4. Put `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GMAIL_TOKEN_ENCRYPTION_KEY` in `.env.local`. Generate the encryption key with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
5. Add your Google account as a test user while the consent screen is in testing mode. Open the dashboard and choose **Connect Gmail**, then **Sync Gmail now**.

The requested Gmail scope is `gmail.readonly`: the application cannot send, delete, or modify messages. Google classifies this scope as restricted; public production use may require Google verification and, depending on the data flow, a security assessment. Personal/testing use and public production verification are different cases. Review current Google policies before making the integration available to other users.

Refresh tokens are encrypted with AES-256-GCM before being stored in MongoDB. Keep the encryption key private and back it up securely; changing it without re-encrypting stored tokens will require reconnecting Gmail. Imported events store message identifiers, headers, a short snippet, detected category, matching job, and confidence—not the full email body. Classification is heuristic and must be treated as evidence, not infallible truth. JobGuard never sends email or automatically submits applications.

### Availability checking

Open a job details page and click **Check job URL**. The checker follows a limited number of redirects, rejects obvious private/local network destinations, reads a bounded amount of public HTML, and looks for strong closure language or application actions. It is a best-effort heuristic: job-board anti-bot pages and ambiguous content should remain `UNKNOWN`/`UNVERIFIED`. Do not treat an HTTP 200 response as proof that a job is open.

### Current limitations

- Gmail sync is user-triggered; automatic periodic syncing and Gmail push notifications are not yet implemented.
- Matching and classification use rules, not an LLM; unmatched/ambiguous messages are recorded for review.
- Job availability checking is manual per job. Scheduled rechecks and provider-specific APIs are future work.
- No application is submitted automatically.
