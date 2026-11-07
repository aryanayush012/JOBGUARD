import Link from "next/link";

export const metadata = { title: "Privacy · JobGuard" };

// Plain-language policy. Keep it in step with what the code actually does.
export default function PrivacyPage() {
  return (
    <main className="page" style={{ maxWidth: 760 }}>
      <nav className="nav"><Link href="/" className="brand" style={{ textDecoration: "none" }}>JOB<span>GUARD</span></Link><Link href="/profile" className="muted small">Your privacy settings</Link></nav>
      <section className="hero"><p className="muted">PRIVACY</p><h1>What JobGuard does with your data.</h1><p className="muted">Short version: we keep only what&apos;s needed to track your jobs and fill your applications, you control every optional feature, and you can delete everything at any time.</p></section>
      <div className="panel privacy-doc">
        <h2>What we store</h2>
        <ul>
          <li><b>Account:</b> your email address, and a password hash if you sign up with a password. Google sign-in gives us only your name and email.</li>
          <li><b>Jobs you save:</b> links, company, title, deadlines, statuses and referrer names.</li>
          <li><b>Profile:</b> your resume PDF and your answers for application forms, both encrypted in our database.</li>
          <li><b>Job emails:</b> for emails matched to a saved job, the sender, subject, a short preview line and the date. Never full email bodies.</li>
        </ul>
        <h2>The browser extension</h2>
        <ul>
          <li>It fills application forms from your answers and attaches your resume. It never clicks Submit, never touches password fields, and never fills or stores answers to personal questions (gender, ethnicity, disability, veteran status and similar).</li>
          <li>With &quot;Update job statuses from Gmail&quot; on, it reads your Gmail inbox list (sender, subject, preview line, date) <b>on your computer</b>. It sends JobGuard only emails that mention one of your saved companies and look job-related. Everything else stays in your browser.</li>
          <li>Verification codes for sign-ups on application sites are found in your browser and are not sent to JobGuard.</li>
          <li>It marks a job as applied when it sees an &quot;application submitted&quot; page for a job you saved.</li>
        </ul>
        <h2>AI assist (optional, off by default)</h2>
        <p>If you turn it on, your resume and the questions from application forms are sent to Google Gemini to read your resume and draft answers. On Gemini&apos;s free tier, Google may use this data to improve its models. With AI assist off, nothing is sent to any AI service.</p>
        <h2>Gmail direct connection (optional beta)</h2>
        <p>Invited testers can connect Gmail with read-only access. JobGuard then reads recent job-related emails from the server to update statuses. The access token is encrypted, and you can disconnect at any time. JobGuard never sends or changes email from your account.</p>
        <h2>Emails we send you</h2>
        <p>A reminder on the morning a saved job&apos;s deadline is due, sent from JobGuard&apos;s own address to the Gmail address you connected.</p>
        <h2>Who we share data with</h2>
        <p>Nobody, except the services that run JobGuard: our database (MongoDB Atlas), our hosting (Vercel), Google (sign-in, and Gemini only if you turn on AI assist). We don&apos;t sell data or show ads.</p>
        <h2>Your controls</h2>
        <ul>
          <li>Turn each optional feature on or off on your <Link href="/profile">Profile</Link> page.</li>
          <li>Disconnect the extension from every browser at any time.</li>
          <li><b>Delete my data</b> on the Profile page removes your account and everything stored for it, and revokes Gmail access.</li>
        </ul>
        <p className="muted small">Questions: jobguard0@gmail.com</p>
      </div>
    </main>
  );
}
