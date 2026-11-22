import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/app-shell";
import { ImportWorkflow } from "@/features/feedback/import-workflow";

export const metadata: Metadata = { title: "Feedback Analysis" };

export default function FeedbackPage() {
  return (
    <>
      <PageHeader title="Feedback Analysis" description="Bring customer reviews, support tickets and other feedback into one place." />
      <ImportWorkflow />
    </>
  );
}
