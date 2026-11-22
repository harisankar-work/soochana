import type { Metadata } from "next";
import { Target } from "lucide-react";
import { PageHeader } from "@/components/layout/app-shell";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata: Metadata = { title: "Prioritization" };

const factors = ["Complaint frequency", "Issue severity", "Trend over time", "Business impact when supported by evidence", "User-defined weights"];

export default function PrioritizationPage() {
  return (
    <>
      <PageHeader title="Prioritization" description="Decide which customer problems to investigate first using evidence from feedback." />
      <EmptyState icon={Target} title="No issues to prioritize yet">
        <p>Evidence-backed scoring is planned for Milestone 6.</p>
      </EmptyState>
      <section className="section panel factors" aria-labelledby="factors">
        <h2 id="factors">Planned scoring factors</h2>
        <ul>{factors.map((factor) => <li key={factor}>{factor}</li>)}</ul>
      </section>
    </>
  );
}
