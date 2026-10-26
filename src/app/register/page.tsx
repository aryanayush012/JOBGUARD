import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { getCurrentUser } from "@/lib/auth";
import { safeNextPath } from "@/lib/http";

export const dynamic = "force-dynamic";

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNextPath((await searchParams).next);
  if (await getCurrentUser()) redirect(next);
  const loginHref = `/login?next=${encodeURIComponent(next)}`;

  return (
    <main className="page">
      <nav className="nav"><Link href="/" className="brand" style={{ textDecoration: "none" }}>JOB<span>GUARD</span></Link><Link href={loginHref} className="muted small">Log in</Link></nav>
      <section className="panel form">
        <h2>Create your account</h2>
        <p className="muted">Your job and referral data will be tied to your account.</p>
        <AuthForm mode="register" next={next} />
        <p className="muted small">Already registered? <Link href={loginHref}>Log in</Link></p>
      </section>
    </main>
  );
}
