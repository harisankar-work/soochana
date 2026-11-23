import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/app-shell";
import { PrioritizationWorkspace } from "@/features/prioritization/workspace";

export const metadata: Metadata = { title: "Prioritization" };

export default function PrioritizationPage() {
  return <>
    <PageHeader title="Prioritization" description="Choose which customer problems to investigate using review evidence and explicit assumptions." />
    <PrioritizationWorkspace />
  </>;
}
