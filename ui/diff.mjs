// Line diff in the shape of `git diff` (unified hunks with context), plus word-level
// highlighting for lines that were changed in place. Dependency-free; task.md files are
// small, so an LCS table over the lines between the common prefix and suffix is cheap.

const CONTEXT = 3;
const MAX_CELLS = 4_000_000; // LCS table cap; beyond it the middle is shown as remove + add

/** Longest-common-subsequence edit script between two arrays: [' '|'-'|'+', aIndex, bIndex][]. */
function editScript(a, b, eq = (x, y) => x === y) {
  let start = 0;
  while (start < a.length && start < b.length && eq(a[start], b[start])) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && eq(a[endA - 1], b[endB - 1])) {
    endA--;
    endB--;
  }
  const ops = [];
  for (let i = 0; i < start; i++) ops.push([' ', i, i]);

  const n = endA - start;
  const m = endB - start;
  if (n * m > MAX_CELLS) {
    for (let i = start; i < endA; i++) ops.push(['-', i, -1]);
    for (let j = start; j < endB; j++) ops.push(['+', -1, j]);
  } else {
    // lcs[i][j] = LCS length of a[start+i..endA) and b[start+j..endB)
    const lcs = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        lcs[i][j] = eq(a[start + i], b[start + j])
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && eq(a[start + i], b[start + j])) {
        ops.push([' ', start + i++, start + j++]);
      } else if (i < n && (j === m || lcs[i + 1][j] >= lcs[i][j + 1])) {
        ops.push(['-', start + i++, -1]); // removals first, like git
      } else {
        ops.push(['+', -1, start + j++]);
      }
    }
  }
  for (let k = 0; endA + k < a.length; k++) ops.push([' ', endA + k, endB + k]);
  return ops;
}

/** Splits a line into words, whitespace runs and punctuation so a cell edit stays local. */
const tokenize = (line) => line.match(/\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu) ?? [];

/** Word-level segments for a changed line pair: [{text, changed}] for the old and new line. */
export function wordDiff(oldLine, newLine) {
  const a = tokenize(oldLine);
  const b = tokenize(newLine);
  const before = [];
  const after = [];
  const push = (list, text, changed) => {
    const last = list[list.length - 1];
    if (last && last.changed === changed) last.text += text;
    else list.push({ text, changed });
  };
  for (const [op, i, j] of editScript(a, b)) {
    if (op === ' ') {
      push(before, a[i], false);
      push(after, b[j], false);
    } else if (op === '-') push(before, a[i], true);
    else push(after, b[j], true);
  }
  return { before, after };
}

/**
 * Unified diff of two texts as hunks:
 * [{ oldStart, oldLines, newStart, newLines, lines: [{ type, text, oldNo, newNo, segments? }] }]
 * plus `added` / `removed` line counts. Line numbers are 1-based, like git.
 */
export function unifiedDiff(oldText, newText) {
  // A final newline terminates the last line; it does not start an empty one (as in git).
  const toLines = (text) => text.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
  const a = toLines(oldText);
  const b = toLines(newText);
  const ops = editScript(a, b);

  const lines = ops.map(([type, i, j]) => ({
    type,
    text: type === '+' ? b[j] : a[i],
    oldNo: i >= 0 ? i + 1 : null,
    newNo: j >= 0 ? j + 1 : null,
  }));

  // Pair runs of removed lines with the following added lines for word highlighting.
  for (let k = 0; k < lines.length; ) {
    if (lines[k].type !== '-') {
      k++;
      continue;
    }
    let r = k;
    while (r < lines.length && lines[r].type === '-') r++;
    let p = r;
    while (p < lines.length && lines[p].type === '+') p++;
    const pairs = Math.min(r - k, p - r);
    for (let x = 0; x < pairs; x++) {
      const { before, after } = wordDiff(lines[k + x].text, lines[r + x].text);
      lines[k + x].segments = before;
      lines[r + x].segments = after;
    }
    k = p;
  }

  const hunks = [];
  let added = 0;
  let removed = 0;
  let k = 0;
  while (k < lines.length) {
    if (lines[k].type === ' ') {
      k++;
      continue;
    }
    // Grow a hunk while changes are within 2*CONTEXT lines of each other.
    const from = Math.max(0, k - CONTEXT);
    let to = k;
    let lastChange = k;
    while (to < lines.length && to - lastChange <= 2 * CONTEXT) {
      if (lines[to].type !== ' ') lastChange = to;
      to++;
    }
    const end = Math.min(lines.length, lastChange + CONTEXT + 1);
    const slice = lines.slice(from, end);
    for (const l of slice) {
      if (l.type === '+') added++;
      if (l.type === '-') removed++;
    }
    const firstOld = slice.find((l) => l.oldNo !== null)?.oldNo ?? 0;
    const firstNew = slice.find((l) => l.newNo !== null)?.newNo ?? 0;
    hunks.push({
      oldStart: firstOld,
      oldLines: slice.filter((l) => l.type !== '+').length,
      newStart: firstNew,
      newLines: slice.filter((l) => l.type !== '-').length,
      lines: slice,
    });
    k = end;
  }
  return { hunks, added, removed };
}
