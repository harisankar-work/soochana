import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ImportWorkflow } from "@/features/feedback/import-workflow";
import { FeedbackSession } from "@/features/feedback/session";

const initial = 'review,date,rating\nPayment crashes,2026-11-01,1\nDelivery was quick,2026-11-02,5\n" Payment  crashes ",,\n" ",,\nShipping slow,01/02/2026,8';

function mount() {
  return render(<FeedbackSession><ImportWorkflow /></FeedbackSession>);
}

function click(name: string | RegExp) {
  fireEvent.click(screen.getByRole("button", { name }));
}

function upload(container: HTMLElement, text: string, name = "sample.csv") {
  const file = new File([text], name);
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  fireEvent.change(input, { target: { files: [file] } });
}

async function toPreview() {
  await screen.findByRole("heading", { name: "Map Columns" });
  click("Review quality");
  click("Preview accepted records");
}

describe("feedback import workflow", () => {
  it("maps and reviews an imported file, inspects row reasons, searches, sorts and confirms", async () => {
    const { container } = mount();
    expect(screen.getByRole("button", { name: "Browse CSV" })).toBeEnabled();
    upload(container, initial);
    await screen.findByRole("heading", { name: "Map Columns" });
    expect(screen.getByLabelText(/Feedback text/)).toHaveValue("0");
    expect(screen.getByText("sample.csv")).toBeVisible();
    click("Review quality");
    const counts = screen.getByText("Accepted records").parentElement;
    expect(counts).toHaveTextContent("3");
    expect(screen.getByText("Rejected records").parentElement).toHaveTextContent("2");
    fireEvent.click(screen.getByText("Inspect row issues (3)"));
    expect(screen.getByText(/duplicate of row 2/i)).toBeVisible();
    expect(screen.getByText(/calendar date/)).toBeVisible();
    click("Preview accepted records");
    const table = screen.getByRole("table", { name: "Accepted feedback" });
    fireEvent.change(screen.getByLabelText("Sort by"), { target: { value: "highest" } });
    expect(within(table).getAllByRole("row")[1]).toHaveTextContent("Delivery was quick");
    fireEvent.change(screen.getByLabelText("Sort by"), { target: { value: "newest" } });
    expect(within(table).getAllByRole("row")[1]).toHaveTextContent("Delivery was quick");
    fireEvent.change(screen.getByLabelText("Search feedback"), { target: { value: "PAYMENT" } });
    expect(screen.getByText("1 matching · 3 accepted records")).toBeVisible();
    fireEvent.change(screen.getByLabelText("Search feedback"), { target: { value: "absent" } });
    expect(screen.getByText(/no records match/i)).toBeVisible();
    click("Continue to confirmation");
    click("Import 3 feedback records");
    expect(screen.getByRole("heading", { name: "Imported dataset" })).toBeVisible();
    click("View imported feedback");
    expect(screen.getByRole("heading", { name: "Imported feedback" })).toBeVisible();
    expect(screen.getByText("Shipping slow")).toBeVisible();
  });

  it("exposes mapping errors and lets users correct the mapping without another upload", async () => {
    const { container } = mount();
    upload(container, "Customer words,Points\nNice,5");
    await screen.findByRole("heading", { name: "Map Columns" });
    click("Review quality");
    expect(screen.getByRole("alert")).toHaveTextContent("Choose a column for Feedback text.");
    fireEvent.change(screen.getByLabelText(/Feedback text/), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText(/Rating/), { target: { value: "0" } });
    click("Review quality");
    expect(screen.getByRole("alert")).toHaveTextContent("Use each CSV column for only one field.");
    fireEvent.change(screen.getByLabelText(/Rating/), { target: { value: "1" } });
    click("Review quality");
    click("Edit column mapping");
    expect(screen.getByLabelText(/Rating/)).toHaveValue("1");
  });

  it("rejects invalid files, accepts drag and drop and handles pagination", async () => {
    const { container } = mount();
    upload(container, "content", "invalid.txt");
    expect(await screen.findByRole("alert")).toHaveTextContent(".csv extension");
    const csv = "review\n" + Array.from({ length: 22 }, (_, index) => `Comment ${index + 1}`).join("\n");
    fireEvent.drop(screen.getByText(/drop a CSV here/i), { dataTransfer: { files: [new File([csv], "drop.csv")] } });
    await toPreview();
    expect(screen.getByText("Page 1 of 2")).toBeVisible();
    click("Next");
    expect(screen.getByText("Page 2 of 2")).toBeVisible();
    expect(screen.getByText("Comment 22")).toBeVisible();
    fireEvent.change(screen.getByLabelText("Search feedback"), { target: { value: "Comment 1" } });
    expect(screen.queryByText("Page 2 of 2")).not.toBeInTheDocument();
    expect(screen.getByText("Comment 1")).toBeVisible();
  });

  it("retains a dataset on cancellation, then confirms replacement and removal", async () => {
    const { container } = mount();
    upload(container, "review\nFirst dataset", "first.csv");
    await toPreview();
    click("Continue to confirmation");
    click("Import 1 feedback record");
    click("Replace dataset");
    click("Cancel replacement");
    expect(screen.getByText("first.csv")).toBeVisible();
    click("Replace dataset");
    upload(container, "review\nSecond dataset", "second.csv");
    await toPreview();
    click("Continue to confirmation");
    expect(screen.getByText(/this replaces/i)).toHaveTextContent("first.csv");
    click("Replace dataset and import 1 feedback record");
    expect(screen.getByText("second.csv")).toBeVisible();
    expect(screen.queryByText("first.csv")).not.toBeInTheDocument();
    click("Remove dataset");
    click("Keep dataset");
    expect(screen.getByText("second.csv")).toBeVisible();
    click("Remove dataset");
    click("Confirm removal");
    expect(screen.getByText("Dataset removed.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Browse CSV" })).toBeVisible();
  });

  it("prevents a zero-record import and allows mapping edits", async () => {
    const { container } = mount();
    upload(container, 'review,alternate\n"   ",Actual feedback');
    await toPreview();
    expect(screen.getByText(/no records passed/i)).toBeVisible();
    expect(screen.getByRole("button", { name: "Continue to confirmation" })).toBeDisabled();
    click("Edit column mapping");
    fireEvent.change(screen.getByLabelText(/Feedback text/), { target: { value: "1" } });
    click("Review quality");
    click("Preview accepted records");
    expect(screen.getByText("Actual feedback")).toBeVisible();
  });
});
