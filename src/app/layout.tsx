import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Job Protection Portal",
  description: "Protect job opportunities while managing referrals and applications."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
