import { render, screen, within } from "@testing-library/react";
import { usePathname } from "next/navigation";
import { describe, expect, it, vi } from "vitest";
import Dashboard from "@/app/page";
import FeedbackPage from "@/app/feedback/page";
import IssuesPage from "@/app/issues/page";
import PrioritizationPage from "@/app/prioritization/page";
import { FeedbackSession } from "@/features/feedback/session";
import { AppShell } from "@/components/layout/app-shell";

vi.mock("next/navigation", () => ({ usePathname: vi.fn(() => "/") }));

describe("application shell", () => {
  it("exposes the main landmark, skip link and each primary route", () => {
    render(<AppShell><p>Page content</p></AppShell>);
    expect(screen.getByRole("main")).toHaveTextContent("Page content");
    expect(screen.getByRole("link", { name: "Skip to content" })).toHaveAttribute("href", "#main-content");
    const nav = within(screen.getByRole("navigation", { name: "Main navigation" }));
    expect(nav.getByRole("link", { name: "Dashboard" })).toHaveAttribute("href", "/");
    expect(nav.getByRole("link", { name: "Feedback Analysis" })).toHaveAttribute("href", "/feedback");
    expect(nav.getByRole("link", { name: "Issue Explorer" })).toHaveAttribute("href", "/issues");
    expect(nav.getByRole("link", { name: "Prioritization" })).toHaveAttribute("href", "/prioritization");
  });

  it("marks the current route for assistive technology", () => {
    vi.mocked(usePathname).mockReturnValueOnce("/issues");
    render(<AppShell>Page content</AppShell>);
    expect(screen.getByRole("link", { name: "Issue Explorer", current: "page" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Dashboard" })).not.toHaveAttribute("aria-current");
  });
});

describe("dashboard", () => {
  it("shows an empty state for every metric", () => {
    render(<Dashboard />);
    for (const label of ["Total Feedback", "Sentiment Breakdown", "Identified Issues", "Priority Issues"]) {
      const card = screen.getByRole("heading", { name: label }).closest("li");
      expect(card).toHaveTextContent("No data yet");
    }
  });

  it("links to feedback and marks the workflow as future work", () => {
    render(<Dashboard />);
    expect(screen.getByRole("link", { name: "Upload Feedback" })).toHaveAttribute("href", "/feedback");
    const workflow = within(screen.getByRole("region", { name: "Feedback workflow" }));
    expect(workflow.getAllByRole("listitem").map((step) => step.textContent)).toEqual([
      "Upload Feedback", "Analyse Sentiment", "Discover Issues", "Prioritize Actions",
    ]);
    expect(workflow.getByText(/CSV import is available.+sentiment analysis.+planned/i)).toBeVisible();
  });
});

describe("feature pages", () => {
  it("shows the CSV upload affordance and browser-only processing note", () => {
    const { container } = render(<FeedbackSession><FeedbackPage /></FeedbackSession>);
    expect(screen.getByRole("button", { name: "Browse CSV" })).toBeEnabled();
    expect(screen.getByText(/file[s]? are processed in this browser/i)).toBeVisible();
    expect(container.querySelector('input[type="file"]')).toHaveAttribute("accept", ".csv,text/csv");
  });

  it("shows the issue empty state and explains how related complaints will be displayed", () => {
    render(<IssuesPage />);
    expect(screen.getByRole("heading", { name: "No issues identified yet" })).toBeVisible();
    expect(screen.getByText(/examples from the original feedback/)).toBeVisible();
  });

  it("presents scoring factors as planned and shows the priority empty state", () => {
    render(<PrioritizationPage />);
    expect(screen.getByRole("heading", { name: "No issues to prioritize yet" })).toBeVisible();
    const factors = within(screen.getByRole("region", { name: "Planned scoring factors" }));
    expect(factors.getAllByRole("listitem")).toHaveLength(5);
    expect(factors.getByText("Business impact when supported by evidence")).toBeVisible();
  });
});
