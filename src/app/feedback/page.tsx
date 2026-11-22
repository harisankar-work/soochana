import type { Metadata } from "next";
import { FileUp } from "lucide-react";
import { PageHeader } from "@/components/layout/app-shell";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata: Metadata = { title: "Feedback Analysis" };

export default function FeedbackPage() {
  return (
    <>
      <PageHeader title="Feedback Analysis" description="Bring customer reviews, support tickets and other feedback into one place." />
      <EmptyState icon={FileUp} title="CSV upload comes in Milestone 2">
        <p>Prepare a CSV with one feedback entry per row and a column for the feedback text. Dates and sources can help add context.</p>
      </EmptyState>
    </>
  );
}
