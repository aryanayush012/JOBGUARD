import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { getCurrentUser } from "@/lib/auth";
import { safeNextPath } from "@/lib/http";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNextPath((await searchParams).next);
  if (await getCurrentUser()) redirect(next);
  const registerHref = `/register?next=${encodeURIComponent(next)}`;

  return (
    <main className="page">
      <nav className="nav"><Link href="/" className="brand" style={{ textDecoration: "none" }}>JOB<span>GUARD</span></Link><Link href={registerHref} className="muted small">Create account</Link></nav>
      <section className="panel form">
        <h2>Welcome back</h2>
        <p className="muted">Log in to continue protecting your opportunities.</p>
        <AuthForm mode="login" next={next} />
        <p className="muted small">New here? <Link href={registerHref}>Create an account</Link></p>
      </section>
    </main>
  );
}
