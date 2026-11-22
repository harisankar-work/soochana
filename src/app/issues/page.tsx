import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/app-shell";
import { IssueExplorer } from "@/features/issues/issue-explorer";

export const metadata: Metadata = { title: "Issue Explorer" };

export default function IssuesPage() {
  return (
    <>
      <PageHeader title="Issue Explorer" description="Discover recurring themes and inspect the original feedback behind each group." />
      <IssueExplorer />
    </>
  );
}
