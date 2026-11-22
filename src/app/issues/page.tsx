import type { Metadata } from "next";
import { Compass } from "lucide-react";
import { PageHeader } from "@/components/layout/app-shell";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata: Metadata = { title: "Issue Explorer" };

export default function IssuesPage() {
  return (
    <>
      <PageHeader title="Issue Explorer" description="Find recurring problems by grouping feedback with similar meaning." />
      <EmptyState icon={Compass} title="No issues identified yet">
        <p>Semantic grouping is planned for Milestone 4. Once available, related complaints will appear together with examples from the original feedback.</p>
      </EmptyState>
    </>
  );
}
