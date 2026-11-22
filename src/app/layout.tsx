import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@fontsource-variable/manrope";
import "@fontsource-variable/newsreader";
import { AppShell } from "@/components/layout/app-shell";
import { FeedbackSession } from "@/features/feedback/session";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Dashboard | VoiceLoop", template: "%s | VoiceLoop" },
  description: "Turn customer feedback into product decisions.",
  icons: { icon: "/voiceloop.svg" },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body><FeedbackSession><AppShell>{children}</AppShell></FeedbackSession></body>
    </html>
  );
}
