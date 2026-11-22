import type { Embedding } from "./protocol";

export const METHODS = ["complete-link-v1", "average-link-v1", "centroid-link-v1", "mutual-nearest-v1"] as const;
export type Method = (typeof METHODS)[number];
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

export function cluster({ ids, scores }: ReturnType<typeof similarityMatrix>, threshold: number, method: Method = "complete-link-v1") {
  if (!Number.isFinite(threshold) || threshold < -1 || threshold > 1) throw new Error("Invalid cosine cutoff.");
  const linkage = scores.map((row) => row.slice());
  const members = ids.map((_, i) => [i]);
  const active = ids.map((_, i) => i);
  // Centroid cosine is computed from Gram sums of the normalized member vectors.
  const gram = method === "centroid-link-v1" ? scores.map((row) => row.slice()) : null;
  const nearest = method === "mutual-nearest-v1" ? ids.map((_, left) => {
    let best = -1;
    for (let right = 0; right < ids.length; right++) {
      if (right !== left && (best < 0 || scores[left][right] > scores[left][best] + EPSILON)) best = right;
    }
    return best;
  }) : null;
  if (nearest) {
    // Disjoint reciprocal top-one pairs. Neither side can grow a chain.
    for (let left = 0; left < ids.length; left++) {
      const right = nearest[left];
      if (right > left && nearest[right] === left && scores[left][right] >= threshold - EPSILON) {
        members[left].push(right);
        active.splice(active.indexOf(right), 1);
      }
    }
  } else {
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
      const firstSize = members[first].length, secondSize = members[second].length;
      members[first].push(...members[second]);
      active.splice(active.indexOf(second), 1);
      if (gram) gram[first][first] += gram[second][second] + 2 * gram[first][second];
      for (const other of active) {
        if (other === first) continue;
        let score;
        if (gram) {
          gram[first][other] += gram[second][other];
          gram[other][first] = gram[first][other];
          const norm = Math.sqrt(Math.max(0, gram[first][first]) * Math.max(0, gram[other][other]));
          score = norm > EPSILON ? Math.max(-1, Math.min(1, gram[first][other] / norm)) : -Infinity;
        } else if (method === "average-link-v1") {
          score = (firstSize * linkage[first][other] + secondSize * linkage[second][other]) / (firstSize + secondSize);
        } else {
          score = Math.min(linkage[first][other], linkage[second][other]);
        }
        linkage[first][other] = linkage[other][first] = score;
      }
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
  return { groups, ungrouped, algorithm: method, threshold };
}
