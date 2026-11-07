import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Job Protection Portal",
  description: "Protect job opportunities while managing referrals and applications."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // The JobGuard extension marks <html> as soon as the page starts loading so the Profile page can detect it.
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
