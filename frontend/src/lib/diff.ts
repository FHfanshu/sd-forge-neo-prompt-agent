export interface DiffLine {
  kind: "same" | "add" | "del";
  text: string;
}

/** Split a prompt into display segments: one per comma-separated item or line, trailing comma kept. */
export function segments(text: string): string[] {
  return text
    .split(/(?<=,)|\n/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Segment-level LCS diff with at most `context` unchanged segments kept around each change. */
export function diffPrompt(before: string, after: string, context = 1): { lines: DiffLine[]; added: number; removed: number } {
  const a = segments(before);
  const b = segments(after);
  const m = a.length;
  const n = b.length;
  const table: Uint16Array[] = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      table[i][j] = norm(a[i]) === norm(b[j]) ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const all: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < m || j < n) {
    if (i < m && j < n && norm(a[i]) === norm(b[j])) {
      all.push({ kind: "same", text: b[j] });
      i++;
      j++;
    } else if (i < m && (j === n || table[i + 1][j] >= table[i][j + 1])) {
      all.push({ kind: "del", text: a[i++] });
    } else {
      all.push({ kind: "add", text: b[j++] });
    }
  }
  const keep = all.map((line, index) =>
    line.kind !== "same" || all.slice(Math.max(0, index - context), index + context + 1).some((near) => near.kind !== "same"),
  );
  const lines: DiffLine[] = [];
  all.forEach((line, index) => {
    if (keep[index]) lines.push(line);
    else if (lines.at(-1)?.text !== "…") lines.push({ kind: "same", text: "…" });
  });
  return {
    lines,
    added: all.filter((line) => line.kind === "add").length,
    removed: all.filter((line) => line.kind === "del").length,
  };
}

function norm(value: string): string {
  return value.replace(/,$/, "").trim();
}
