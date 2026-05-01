function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[\s\W]+/).filter(Boolean);
}

function lcsLength(a: string[], b: string[]): number {
  const m = a.length;
  const n = b.length;
  const dp: number[] = new Array(n + 1).fill(0);
  for (let i = 0; i < m; i++) {
    let prev = 0;
    for (let j = 0; j < n; j++) {
      const temp = dp[j + 1]!;
      dp[j + 1] = a[i] === b[j] ? prev + 1 : Math.max(dp[j + 1]!, dp[j]!);
      prev = temp;
    }
  }
  return dp[n]!;
}

export interface RougeScore {
  precision: number;
  recall: number;
  f1: number;
}

export function rougeL(hypothesis: string, reference: string): RougeScore {
  const hyp = tokenize(hypothesis);
  const ref = tokenize(reference);
  if (hyp.length === 0 || ref.length === 0) return { precision: 0, recall: 0, f1: 0 };
  const lcs = lcsLength(hyp, ref);
  const precision = lcs / hyp.length;
  const recall = lcs / ref.length;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { precision, recall, f1 };
}

export function meanRougeL(pairs: Array<{ hypothesis: string; reference: string }>): RougeScore {
  if (pairs.length === 0) return { precision: 0, recall: 0, f1: 0 };
  const scores = pairs.map((p) => rougeL(p.hypothesis, p.reference));
  const avg = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / arr.length;
  return {
    precision: avg(scores.map((s) => s.precision)),
    recall: avg(scores.map((s) => s.recall)),
    f1: avg(scores.map((s) => s.f1)),
  };
}
