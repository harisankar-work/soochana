import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@fontsource-variable/manrope";
import "@fontsource-variable/newsreader";
import { AppShell } from "@/components/layout/app-shell";
import { FeedbackSession } from "@/features/feedback/session";
import "./globals.css";

const tagline = "Turn customer feedback into clear product decisions.";

export const metadata: Metadata = {
  title: { default: "Dashboard | Soochana", template: "%s | Soochana" },
  description: tagline,
  applicationName: "Soochana",
  openGraph: { title: "Soochana", description: tagline, siteName: "Soochana", type: "website" },
  twitter: { card: "summary", title: "Soochana", description: tagline },
  icons: { icon: "/soochana.svg" },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body><FeedbackSession><AppShell>{children}</AppShell></FeedbackSession></body>
    </html>
  );
}
