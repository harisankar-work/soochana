import { readCsv, type ParsedCsv } from "../feedback/csv";
import { suggestMapping, validateRows, type FeedbackRecord } from "../feedback/validation";
import { DIMENSIONS, MODEL_REVISION as embeddingRevision, validEmbedding, type Embedding } from "../issues/protocol";
import { MODEL_REVISION as sentimentRevision, parsePrediction } from "../sentiment/protocol";
import { isAssessment, type Candidate } from "../prioritization/candidates";
import examples from "./assumptions.json";

export const marketplaceSize = 100;
export const marketplaceFilename = "soochana-demo.csv";
export const marketplaceMethod = "average-link-v1" as const;
export const marketplaceCutoff = 0.45;

export async function fetchMarketplaceFile() {
  const response = await fetch(`/demo/${marketplaceFilename}`);
  if (!response.ok) throw new Error("The demo CSV could not be loaded. Try again or browse for your own CSV.");
  return new File([await response.blob()], marketplaceFilename, { type: "text/csv" });
}

export function withMarketplaceMetadata(csv: ParsedCsv, records: FeedbackRecord[]) {
  const [id, platform, segment] = ["feedback_id", "client_platform", "customer_segment"].map((key) => csv.headers.indexOf(key));
  const rows = new Map(csv.rows.map(({ originalRow, cells }) => [originalRow, cells]));
  return records.map((record) => {
    const cells = rows.get(record.originalRow);
    if (!cells?.[id] || !cells[platform] || !cells[segment]) throw new Error("The demo feedback metadata is incomplete.");
    return { ...record, marketplace: { feedbackId: cells[id], platform: cells[platform], segment: cells[segment] } };
  });
}

export async function readPreparedMarketplace() {
  const [file, response] = await Promise.all([
    fetchMarketplaceFile(), fetch("/demo/marketplace-analysis.json"),
  ]);
  if (!response.ok) throw new Error("Prepared analysis is unavailable.");
  const [csv, digest, asset] = await Promise.all([
    readCsv(file), file.arrayBuffer().then((buffer) => crypto.subtle.digest("SHA-256", buffer)), response.json(),
  ]);
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const { accepted: records, issues } = validateRows(csv, suggestMapping(csv.headers));
  if (issues.length || records.length !== marketplaceSize || asset?.schema !== 1 || asset.csvSha256 !== hash ||
    asset.sentimentRevision !== sentimentRevision || asset.embeddingRevision !== embeddingRevision ||
    !Array.isArray(asset.predictions) || asset.predictions.length !== records.length || typeof asset.embeddings !== "string") {
    throw new Error("The prepared analysis does not match the demo dataset or pinned models.");
  }
  const bytes = Uint8Array.from(atob(asset.embeddings), (character) => character.charCodeAt(0));
  const view = new DataView(bytes.buffer);
  if (bytes.length !== records.length * DIMENSIONS * 4) throw new Error("Prepared embeddings are incomplete.");
  const predictions = records.map(({ id }, index) => {
    const prediction = parsePrediction(id, asset.predictions[index]);
    if (!prediction) throw new Error("Prepared sentiment is incomplete.");
    return prediction;
  });
  const embeddings = records.map(({ id }, index): Embedding => {
    const vector = Float32Array.from({ length: DIMENSIONS }, (_, dimension) => view.getFloat32((index * DIMENSIONS + dimension) * 4, true));
    if (!validEmbedding(vector)) throw new Error("A prepared embedding is invalid.");
    return { id, vector };
  });
  return { dataset: { name: file.name, size: file.size, records: withMarketplaceMetadata(csv, records), marketplace: true as const }, predictions, embeddings };
}

export function illustrateMarketplaceIssues(candidates: Candidate[], records: FeedbackRecord[]) {
  const lookup = new Map(records.map((record) => [record.id, record]));
  const chosen = new Set<string>();
  const illustrations = new Map<string, Candidate>();
  for (const example of examples) {
    if (!isAssessment(example.severity) || !isAssessment(example.impact) || !isAssessment(example.confidence)) continue;
    const options = candidates.flatMap((candidate) => {
      if (!candidate.origin || chosen.has(candidate.id)) return [];
      const evidence = candidate.evidenceIds.flatMap((id) => lookup.get(id) ?? []);
      const inArea = evidence.filter(({ category }) => category === example.area);
      if (inArea.length < 3 || inArea.length / evidence.length < 0.75) return [];
      return [{ candidate, count: inArea.length, anchor: inArea.some(({ originalRow }) => originalRow === example.originalRow) }];
    }).sort((a, b) => Number(b.anchor) - Number(a.anchor) || b.count - a.count);
    const match = options[0]?.candidate;
    if (!match) continue;
    chosen.add(match.id);
    illustrations.set(match.id, {
      ...match, title: example.title, description: example.description,
      severity: example.severity, impact: example.impact, confidence: example.confidence,
      review: example.reviewed ? "Reviewed" : "Needs review",
      illustrative: true, evidenceVersion: 0, assessedVersion: 0,
    });
  }
  return candidates.map((candidate) => illustrations.get(candidate.id) ?? candidate);
}
