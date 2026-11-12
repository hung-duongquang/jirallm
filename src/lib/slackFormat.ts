/**
 * Turns text copied from a Claude Code terminal (markdown, box-drawing tables, the "● " bullet and
 * two-space indent of a reply) into something that reads well in Slack, which has no tables: each
 * table row becomes a bullet ("*first cell* — other cells"). Produces HTML for the clipboard (Slack
 * keeps bold, lists, links and code when rich text is pasted) and a plain-text fallback.
 */

type Block =
  | { kind: 'para'; lines: string[] }
  | { kind: 'heading'; text: string }
  | { kind: 'list'; items: Array<{ level: number; ordered: boolean; text: string }> }
  | { kind: 'table'; header?: string[]; rows: string[][] }
  | { kind: 'code'; lines: string[] };

const BOX_TOP = /^[┌╭┏╔]/;
const BOX_BOTTOM = /^[└╰┗╚]/;
const BOX_SEP = /^[├┝┠┣╞╟╠]/;
const BOX_ROW = /^[│┃║]/;
const BOX_BAR = /[│┃║]/;
const LIST_ITEM = /^(\s*)([-*•◦▪]|\d+[.)])\s+(.*)$/;
const MD_TABLE_SEP = /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;
const EMPTY_CELL = new Set(['', '—', '–', '-']);

/** Drops the reply marker and the indent Claude Code puts before every line of a reply. */
export function normalizeTerminalText(text: string): string[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/\s+$/, ''));
  const first = lines.findIndex((l) => l.trim());
  if (first >= 0) lines[first] = lines[first]!.replace(/^(\s*)[●⏺]\s/, '$1  ');
  const indents = lines.filter((l) => l.trim()).map((l) => /^ */.exec(l)![0].length);
  const cut = indents.length ? Math.min(...indents) : 0;
  const out = lines.map((l) => l.slice(cut));
  while (out.length && !out[0]!.trim()) out.shift();
  while (out.length && !out[out.length - 1]!.trim()) out.pop();
  return out;
}

function boxTable(lines: string[]): { header?: string[]; rows: string[][] } {
  const rows: string[][] = [];
  let current: string[][] | null = null;
  let separators = 0;
  let headerRows = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (BOX_SEP.test(line)) {
      if (current) rows.push(current.map((c) => c.join(' ')));
      current = null;
      if (separators++ === 0) headerRows = rows.length;
    } else if (BOX_ROW.test(line)) {
      const cells = line.split(BOX_BAR).slice(1, -1).map((c) => c.trim());
      current ??= cells.map(() => []);
      cells.forEach((c, i) => c && (current![i] ??= []).push(c));
    }
  }
  if (current) rows.push(current.map((c) => c.join(' ')));
  return headerRows === 1 && rows.length > 1 ? { header: rows[0], rows: rows.slice(1) } : { rows };
}

const mdCells = (line: string) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

export function parseBlocks(text: string): Block[] {
  const lines = normalizeTerminalText(text);
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ kind: 'para', lines: para });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();
    if (!trimmed) {
      flush();
      continue;
    }
    if (BOX_TOP.test(trimmed)) {
      flush();
      const start = i;
      while (i < lines.length - 1 && !BOX_BOTTOM.test(lines[i]!.trim())) i++;
      blocks.push({ kind: 'table', ...boxTable(lines.slice(start, i + 1)) });
      continue;
    }
    if (trimmed.startsWith('|') && MD_TABLE_SEP.test(lines[i + 1]?.trim() ?? '')) {
      flush();
      const header = mdCells(trimmed);
      const rows: string[][] = [];
      for (i += 2; i < lines.length && lines[i]!.trim().startsWith('|'); i++) rows.push(mdCells(lines[i]!));
      i--;
      blocks.push({ kind: 'table', header, rows });
      continue;
    }
    if (trimmed.startsWith('```')) {
      flush();
      const code: string[] = [];
      for (i++; i < lines.length && !lines[i]!.trim().startsWith('```'); i++) code.push(lines[i]!);
      blocks.push({ kind: 'code', lines: code });
      continue;
    }
    const heading = /^#{1,6}\s+(.*)$/.exec(trimmed);
    if (heading) {
      flush();
      blocks.push({ kind: 'heading', text: heading[1]! });
      continue;
    }
    const item = LIST_ITEM.exec(line);
    if (item) {
      flush();
      const entry = { level: Math.floor(item[1]!.length / 2), ordered: /\d/.test(item[2]!), text: item[3]! };
      const last = blocks[blocks.length - 1];
      if (last?.kind === 'list') last.items.push(entry);
      else blocks.push({ kind: 'list', items: [entry] });
      continue;
    }
    // A wrapped continuation of a list item (indented, no marker) belongs to that item.
    const last = blocks[blocks.length - 1];
    if (!para.length && last?.kind === 'list' && /^\s{2,}/.test(line)) {
      last.items[last.items.length - 1]!.text += ` ${trimmed}`;
      continue;
    }
    para.push(trimmed);
  }
  flush();
  return blocks;
}

/** A table row as one bullet: the first cell bold, the other non-empty cells after a dash. */
function rowParts(row: string[]): { lead: string; rest: string[] } {
  return { lead: row[0] ?? '', rest: row.slice(1).filter((c) => !EMPTY_CELL.has(c)) };
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Inline markdown → HTML: code, bold, italics, links, bare URLs. */
export function inlineHtml(text: string): string {
  const codes: string[] = [];
  let s = escapeHtml(text).replace(/`([^`]+)`/g, (_, c: string) => `${codes.push(c) - 1}`);
  s = s
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>')
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2">$2</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/__([^_]+)__/g, '<b>$1</b>')
    .replace(/(^|[\s(])\*([^*\s][^*]*?)\*(?=[\s).,:;!?]|$)/g, '$1<i>$2</i>');
  return s.replace(/(\d+)/g, (_, n: string) => `<code>${codes[Number(n)]}</code>`);
}

/** Inline markdown → Slack's own markup, for a plain-text paste: *bold*, _italic_, `code`, "text (url)". */
export function inlinePlain(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1 ($2)')
    .replace(/\*\*([^*]+)\*\*/g, '*$1*')
    .replace(/__([^_]+)__/g, '*$1*');
}

function listHtml(items: Array<{ level: number; ordered: boolean; text: string }>): string {
  let out = '';
  const open: string[] = [];
  for (const it of items) {
    const tag = it.ordered ? 'ol' : 'ul';
    while (open.length > it.level + 1) out += `</li></${open.pop()}>`;
    if (open.length === it.level + 1 && open[open.length - 1] !== tag) out += `</li></${open.pop()}>`;
    if (open.length === it.level + 1) out += '</li>';
    while (open.length < it.level + 1) {
      out += `<${tag}>`;
      open.push(tag);
    }
    out += `<li>${inlineHtml(it.text)}`;
  }
  while (open.length) out += `</li></${open.pop()}>`;
  return out;
}

export function toSlackHtml(text: string): string {
  return parseBlocks(text)
    .map((b) => {
      switch (b.kind) {
        case 'para':
          return `<p>${b.lines.map(inlineHtml).join('<br>')}</p>`;
        case 'heading':
          return `<p><b>${inlineHtml(b.text)}</b></p>`;
        case 'code':
          return `<pre>${escapeHtml(b.lines.join('\n'))}</pre>`;
        case 'list':
          return listHtml(b.items);
        case 'table':
          return `<ul>${b.rows
            .map((r) => {
              const { lead, rest } = rowParts(r);
              return `<li><b>${inlineHtml(lead)}</b>${rest.length ? ` — ${rest.map(inlineHtml).join(' — ')}` : ''}</li>`;
            })
            .join('')}</ul>`;
      }
    })
    .join('');
}

export function toSlackText(text: string): string {
  return parseBlocks(text)
    .map((b) => {
      switch (b.kind) {
        case 'para':
          return b.lines.map(inlinePlain).join('\n');
        case 'heading':
          return `*${inlinePlain(b.text).replace(/\*/g, '')}*`;
        case 'code':
          return `\`\`\`\n${b.lines.join('\n')}\n\`\`\``;
        case 'list':
          return b.items.map((it, n) => `${'    '.repeat(it.level)}${it.ordered ? `${n + 1}.` : '•'} ${inlinePlain(it.text)}`).join('\n');
        case 'table':
          return b.rows
            .map((r) => {
              const { lead, rest } = rowParts(r);
              return `• *${inlinePlain(lead).replace(/\*/g, '')}*${rest.length ? ` — ${rest.map(inlinePlain).join(' — ')}` : ''}`;
            })
            .join('\n');
      }
    })
    .join('\n\n');
}

/** The clipboard's CF_HTML format (Windows): a header with UTF-8 byte offsets around the fragment. */
export function cfHtml(fragment: string): string {
  const head = 'Version:0.9\r\nStartHTML:SSSSSSSSSS\r\nEndHTML:EEEEEEEEEE\r\nStartFragment:FFFFFFFFFF\r\nEndFragment:GGGGGGGGGG\r\n';
  const pre = '<html><body><!--StartFragment-->';
  const post = '<!--EndFragment--></body></html>';
  const bytes = (s: string) => Buffer.byteLength(s, 'utf8');
  const pad = (n: number) => String(n).padStart(10, '0');
  const startHtml = bytes(head);
  const startFragment = startHtml + bytes(pre);
  const endFragment = startFragment + bytes(fragment);
  const endHtml = endFragment + bytes(post);
  return (
    head
      .replace('SSSSSSSSSS', pad(startHtml))
      .replace('EEEEEEEEEE', pad(endHtml))
      .replace('FFFFFFFFFF', pad(startFragment))
      .replace('GGGGGGGGGG', pad(endFragment)) +
    pre +
    fragment +
    post
  );
}
