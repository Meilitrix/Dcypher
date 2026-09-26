import type { DiffLine } from '@decypher/core';

/**
 * Zero-dependency line diff built on a classic LCS dynamic program.
 * Returns a full list of context/added/removed lines. Input strings are split
 * on newlines; a trailing newline is ignored so it does not create a phantom line.
 */
function splitLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

export function diffLines(oldText: string, newText: string): DiffLine[] {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  const n = a.length;
  const m = b.length;

  // lcs[i][j] = length of LCS of a[i..] and b[j..]
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: 'context', text: a[i], oldLine: i + 1, newLine: j + 1 });
      i += 1;
      j += 1;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ kind: 'removed', text: a[i], oldLine: i + 1 });
      i += 1;
    } else {
      out.push({ kind: 'added', text: b[j], newLine: j + 1 });
      j += 1;
    }
  }
  while (i < n) {
    out.push({ kind: 'removed', text: a[i], oldLine: i + 1 });
    i += 1;
  }
  while (j < m) {
    out.push({ kind: 'added', text: b[j], newLine: j + 1 });
    j += 1;
  }
  return out;
}

/** Collapse long runs of unchanged lines into a single "…" marker to keep UIs short. */
export function collapseContext(lines: DiffLine[], context = 3): DiffLine[] {
  const keep = new Set<number>();
  lines.forEach((line, idx) => {
    if (line.kind !== 'context') {
      for (let k = idx - context; k <= idx + context; k += 1) {
        if (k >= 0 && k < lines.length) keep.add(k);
      }
    }
  });
  if (keep.size === lines.length) return lines;

  const result: DiffLine[] = [];
  let skipping = false;
  lines.forEach((line, idx) => {
    if (keep.has(idx)) {
      if (skipping) {
        result.push({ kind: 'context', text: '…' });
        skipping = false;
      }
      result.push(line);
    } else {
      skipping = true;
    }
  });
  return result;
}
