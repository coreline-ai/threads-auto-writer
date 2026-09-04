export type DiffChunk = {
  type: "equal" | "insert" | "delete";
  value: string;
};

export function diffWords(before: string, after: string): DiffChunk[] {
  const a = before.split(/(\s+)/).filter(Boolean);
  const b = after.split(/(\s+)/).filter(Boolean);
  const table = Array.from({ length: a.length + 1 }, () =>
    Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i]![j] =
        a[i] === b[j]
          ? table[i + 1]![j + 1]! + 1
          : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  const chunks: DiffChunk[] = [];
  const push = (type: DiffChunk["type"], value: string) => {
    const last = chunks.at(-1);
    if (last?.type === type) last.value += value;
    else chunks.push({ type, value });
  };
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push("equal", a[i]!);
      i += 1;
      j += 1;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      push("delete", a[i++]!);
    } else {
      push("insert", b[j++]!);
    }
  }
  while (i < a.length) push("delete", a[i++]!);
  while (j < b.length) push("insert", b[j++]!);
  return chunks;
}
