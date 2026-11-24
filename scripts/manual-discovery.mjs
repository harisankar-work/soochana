// Evaluation runs control their own model start so timings exclude automatic discovery.
export async function manualDiscovery(page) {
  const control = page.getByRole("checkbox", { name: "Automatically discover issues after import" });
  if (await control.count()) await control.uncheck();
}
