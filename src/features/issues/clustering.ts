import type { Embedding } from "./protocol";

export const ALGORITHM = "complete-link-v1";
const EPSILON = 1e-12;

export type IssueGroup = {
  id: string;
  feedbackIds: string[];
  representativeId: string;
  cohesion: number;
  similarities: Record<string, number>;
  labelSource: "representative";
};

export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number | null {
  if (!a.length || a.length !== b.length) return null;
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i], y = b[i];
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    dot += x * y;
    aa += x * x;
    bb += y * y;
  }
  const normA = Math.sqrt(aa), normB = Math.sqrt(bb);
  if (!Number.isFinite(normA) || !Number.isFinite(normB) || normA <= EPSILON || normB <= EPSILON) return null;
  return Math.max(-1, Math.min(1, dot / normA / normB));
}

export function similarityMatrix(embeddings: readonly Embedding[]) {
  const ordered = [...embeddings].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const ids = ordered.map(({ id }) => id);
  if (new Set(ids).size !== ids.length) throw new Error("Duplicate embedding IDs.");
  const scores = ordered.map(() => new Float64Array(ordered.length));
  for (let i = 0; i < ordered.length; i++) {
    scores[i][i] = 1;
    for (let j = i + 1; j < ordered.length; j++) {
      const score = cosine(ordered[i].vector, ordered[j].vector);
      if (score === null) throw new Error("Invalid embedding pair.");
      scores[i][j] = scores[j][i] = score;
    }
  }
  return { ids, scores };
}

export function cluster({ ids, scores }: ReturnType<typeof similarityMatrix>, threshold: number) {
  const linkage = scores.map((row) => row.slice());
  const members = ids.map((_, i) => [i]);
  const active = ids.map((_, i) => i);
  // Sorted IDs define a stable first-pair tie break. Merging retains the smaller slot.
  while (active.length > 1) {
    let first = -1, second = -1, best = -Infinity;
    for (let i = 0; i < active.length; i++) {
      for (let j = i + 1; j < active.length; j++) {
        const left = active[i], right = active[j];
        const score = linkage[left][right];
        if (score >= threshold - EPSILON && score > best + EPSILON) {
          first = left;
          second = right;
          best = score;
        }
      }
    }
    if (first < 0) break;
    members[first].push(...members[second]);
    active.splice(active.indexOf(second), 1);
    for (const other of active) {
      if (other === first) continue;
      linkage[first][other] = linkage[other][first] = Math.min(linkage[first][other], linkage[second][other]);
    }
  }

  const groups: IssueGroup[] = [];
  const ungrouped: string[] = [];
  for (const slot of active) {
    const indices = members[slot].sort((a, b) => a - b);
    if (indices.length === 1) {
      ungrouped.push(ids[indices[0]]);
      continue;
    }
    const totals = new Map(indices.map((index) => [index, 0]));
    let sum = 0;
    for (let i = 0; i < indices.length; i++) {
      for (let j = i + 1; j < indices.length; j++) {
        const a = indices[i], b = indices[j], score = scores[a][b];
        sum += score;
        totals.set(a, totals.get(a)! + score);
        totals.set(b, totals.get(b)! + score);
      }
    }
    const representative = indices.reduce((best, index) => totals.get(index)! > totals.get(best)! + EPSILON ? index : best);
    const feedbackIds = indices.map((index) => ids[index]);
    groups.push({
      id: JSON.stringify(feedbackIds), feedbackIds, representativeId: ids[representative],
      cohesion: sum / (indices.length * (indices.length - 1) / 2),
      similarities: Object.fromEntries(indices.map((index) => [ids[index], scores[representative][index]])),
      labelSource: "representative",
    });
  }
  groups.sort((a, b) => b.feedbackIds.length - a.feedbackIds.length || (a.id < b.id ? -1 : 1));
  return { groups, ungrouped, algorithm: ALGORITHM, threshold };
}
