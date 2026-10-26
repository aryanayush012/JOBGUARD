import Link from "next/link";

export default function HomePage() {
  return (
    <main className="page">
      <nav className="nav">
        <div className="brand">JOB<span>GUARD</span></div>
        <div className="actions">
          <Link className="button secondary" href="/login">Log in</Link>
          <Link className="button" href="/register">Create account</Link>
        </div>
      </nav>

      <section className="hero">
        <p className="muted">JOB REFERRAL & APPLICATION PROTECTION</p>
        <h1>Don’t let waiting for a referral cost you an opportunity.</h1>
        <p className="muted">
          Keep referral outreach and application preparation moving in parallel.
          Track each opportunity and make your next step before the deadline gets away.
        </p>
        <div className="actions" style={{ marginTop: 24 }}>
          <Link className="button" href="/register">Get started</Link>
          <Link className="button secondary" href="/login">I already have an account</Link>
        </div>
      </section>

      <section className="grid">
        <div className="panel stat"><strong>01</strong><span>Track referrals</span><p className="muted small">Keep each contact and outreach status organized per job.</p></div>
        <div className="panel stat"><strong>02</strong><span>Prepare in parallel</span><p className="muted small">Work on your application while referral conversations continue.</p></div>
        <div className="panel stat"><strong>03</strong><span>Protect deadlines</span><p className="muted small">Use clear reminders and retain control of submission.</p></div>
      </section>

      <p className="footer">Personal-use starter · Human approval required before application submission</p>
    </main>
  );
}
