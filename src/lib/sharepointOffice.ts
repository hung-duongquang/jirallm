import { execFile } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Office documents on SharePoint (PowerPoint, Word, Excel) are read through the Office desktop
 * apps over COM: the app opens the link with the user's own Office sign-in, so no cookie is
 * needed and sharing links (`/:p:/s/<site>/<token>`) work as they are. Windows only.
 */

export type OfficeKind = 'powerpoint' | 'word' | 'excel';
export type OfficeLink = { url: string; kind: OfficeKind; site: string; fileName?: string };

const SHARE_KIND: Record<string, OfficeKind> = { p: 'powerpoint', w: 'word', x: 'excel' };
const EXT_KIND: Record<string, OfficeKind> = {
  pptx: 'powerpoint', ppt: 'powerpoint', pptm: 'powerpoint', ppsx: 'powerpoint',
  docx: 'word', doc: 'word', docm: 'word', rtf: 'word',
  xlsx: 'excel', xls: 'excel', xlsm: 'excel', csv: 'excel',
};

function kindOfName(name: string | null | undefined): OfficeKind | undefined {
  const ext = name?.split('.').pop()?.toLowerCase();
  return ext ? EXT_KIND[ext] : undefined;
}

/**
 * Recognises a link to an Office document: a sharing link (`/:p:/`, `/:w:/`, `/:x:/`), a direct
 * file path (`…/Shared Documents/x.pptx`) or a viewer link (`…/_layouts/15/Doc.aspx?…&file=x.pptx`).
 * Returns undefined for anything else (pages, folders, other hosts).
 */
export function parseOfficeLink(url: string): OfficeLink | undefined {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return undefined;
  }
  if (!/\.sharepoint\.com$/i.test(u.hostname)) return undefined;
  const path = decodeURIComponent(u.pathname);
  const parts = path.split('/').filter(Boolean);
  const share = /^:([a-z]):$/i.exec(parts[0] ?? '');
  if (share) {
    const kind = SHARE_KIND[share[1].toLowerCase()];
    if (!kind) return undefined;
    // /:p:/s/<site>/<token> or /:p:/r/sites/<site>/…/<file>
    const sitesAt = parts.indexOf('sites');
    const site = parts[1] === 's' ? parts[2] : sitesAt > 0 ? parts[sitesAt + 1] : undefined;
    const last = parts.at(-1);
    return { url, kind, site: site ?? 'root', fileName: kindOfName(last) ? last : undefined };
  }
  const sitesAt = parts.findIndex((p) => p === 'sites' || p === 'teams');
  const site = sitesAt >= 0 ? parts[sitesAt + 1] ?? 'root' : 'root';
  if (/\/_layouts\/15\/(doc|doc2|xlviewer|wopiframe)\.aspx$/i.test(path)) {
    const file = u.searchParams.get('file');
    const kind = kindOfName(file);
    return kind ? { url, kind, site, fileName: file ?? undefined } : undefined;
  }
  const last = parts.at(-1);
  const kind = kindOfName(last);
  return kind ? { url, kind, site, fileName: last } : undefined;
}

export function isOfficeDocumentUrl(url: string): boolean {
  return parseOfficeLink(url) !== undefined;
}

// ---------------------------------------------------------------------------------------------
// Extraction (PowerShell + COM)
// ---------------------------------------------------------------------------------------------

export type SlideShape = { name: string; paragraphs: string[] };
export type Slide = { index: number; hidden: boolean; title: string; shapes: SlideShape[]; tables: string[][][]; pictures: number; notes: string };
export type WordBlock = { type: 'paragraph'; level: number; list: boolean; text: string } | { type: 'table'; rows: string[][] };
export type Sheet = { name: string; csv: string; rows: number; columns: number };

export type OfficeDocument =
  | { kind: 'powerpoint'; name: string; slides: Slide[] }
  | { kind: 'word'; name: string; blocks: WordBlock[] }
  | { kind: 'excel'; name: string; sheets: Sheet[] };

/**
 * Writes JSON to -Json and, with -Copy, a local copy of the file. Opens read-only without a
 * window. PowerPoint is a single instance shared with the user, so it is only closed when this
 * script started it and nothing else is open; Word and Excel get their own instance.
 */
export const OFFICE_EXTRACT_PS1 = String.raw`
param([string]$Url, [string]$Kind, [string]$Json, [string]$Copy, [string]$TempDir)
$ErrorActionPreference = 'Stop'
$NL = [string][char]10
function Txt($s) { if ($null -eq $s) { '' } else { ([string]$s) -replace "[\r\v\a]+$", '' -replace "\v", $NL } }
function Paras($tr) { @(((Txt $tr.Text) -split "\r") | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne '' }) }
$out = $null
switch ($Kind) {
  'powerpoint' {
    $running = @(Get-Process POWERPNT -ErrorAction SilentlyContinue).Count -gt 0
    $app = New-Object -ComObject PowerPoint.Application
    try {
      $p = $app.Presentations.Open($Url, -1, 0, 0)
      try {
        if ($Copy) { $p.SaveCopyAs($Copy) }
        $slides = @()
        foreach ($s in $p.Slides) {
          $shapes = New-Object System.Collections.ArrayList
          $tables = New-Object System.Collections.ArrayList
          $pictures = 0
          $title = ''
          $queue = New-Object System.Collections.Queue
          foreach ($sh in $s.Shapes) { $queue.Enqueue($sh) }
          while ($queue.Count -gt 0) {
            $sh = $queue.Dequeue()
            if ($sh.Type -eq 6) { foreach ($g in $sh.GroupItems) { $queue.Enqueue($g) }; continue }
            if ($sh.Type -eq 13 -or $sh.Type -eq 11) { $pictures++ }
            if ($sh.HasTable) {
              $rows = @()
              for ($r = 1; $r -le $sh.Table.Rows.Count; $r++) {
                $cells = @(); for ($c = 1; $c -le $sh.Table.Columns.Count; $c++) { $cells += ((Paras $sh.Table.Cell($r, $c).Shape.TextFrame.TextRange) -join ' / ') }
                $rows += ,$cells
              }
              [void]$tables.Add($rows); continue
            }
            if ($sh.HasSmartArt) { $t = @(); foreach ($n in $sh.SmartArt.AllNodes) { $t += (Txt $n.TextFrame2.TextRange.Text).Trim() }; [void]$shapes.Add(@{ name = $sh.Name; paragraphs = @($t | Where-Object { $_ }) }); continue }
            if ($sh.HasTextFrame -and $sh.TextFrame.HasText) {
              $paras = Paras $sh.TextFrame.TextRange
              $isTitle = $false
              try { $isTitle = $sh.Type -eq 14 -and @(1, 3).Contains([int]$sh.PlaceholderFormat.Type) } catch {}
              if ($isTitle -and -not $title) { $title = $paras -join ' ' } else { [void]$shapes.Add(@{ name = $sh.Name; paragraphs = $paras }) }
            }
          }
          $notes = ''
          try { foreach ($n in $s.NotesPage.Shapes) { if ($n.Type -eq 14 -and $n.PlaceholderFormat.Type -eq 2 -and $n.TextFrame.HasText) { $notes = (Paras $n.TextFrame.TextRange) -join $NL } } } catch {}
          $slides += @{ index = $s.SlideIndex; hidden = [bool]$s.SlideShowTransition.Hidden; title = $title; shapes = @($shapes); tables = @($tables); pictures = $pictures; notes = $notes }
        }
        $out = @{ kind = 'powerpoint'; name = $p.Name; slides = @($slides) }
      } finally { $p.Close() }
    } finally { if (-not $running -and $app.Presentations.Count -eq 0) { $app.Quit() } }
  }
  'word' {
    $app = New-Object -ComObject Word.Application
    $app.Visible = $false; $app.DisplayAlerts = 0
    try {
      $d = $app.Documents.Open($Url, $false, $true, $false)
      try {
        $blocks = New-Object System.Collections.ArrayList
        $doneTables = @{}
        foreach ($para in $d.Paragraphs) {
          $r = $para.Range
          if ($r.Information(12)) {
            $t = $r.Tables.Item(1); $key = $t.Range.Start
            if ($doneTables.ContainsKey($key)) { continue }
            $doneTables[$key] = $true
            $rows = @()
            foreach ($row in $t.Rows) { $cells = @(); foreach ($cell in $row.Cells) { $cells += ((Txt $cell.Range.Text) -replace "[\r\n]+", ' / ').Trim(' /') }; $rows += ,$cells }
            [void]$blocks.Add(@{ type = 'table'; rows = $rows }); continue
          }
          $text = (Txt $r.Text).Trim()
          if (-not $text) { continue }
          [void]$blocks.Add(@{ type = 'paragraph'; level = [int]$para.OutlineLevel; list = [bool]($r.ListFormat.ListType -ne 0); text = $text })
        }
        $out = @{ kind = 'word'; name = $d.Name; blocks = @($blocks) }
        if ($Copy) { $d.SaveAs2($Copy) }
      } finally { $d.Close(0) }
    } finally { $app.Quit() }
  }
  'excel' {
    $app = New-Object -ComObject Excel.Application
    $app.Visible = $false; $app.DisplayAlerts = $false
    try {
      $wb = $app.Workbooks.Open($Url, 0, $true)
      try {
        if ($Copy) { $wb.SaveCopyAs($Copy) }
        $sheets = @(); $i = 0
        foreach ($ws in $wb.Worksheets) {
          $i++
          $used = $ws.UsedRange
          $csvPath = Join-Path $TempDir "sheet$i.csv"
          $ws.Copy()
          $tmp = $app.ActiveWorkbook
          $tmp.SaveAs($csvPath, 62)
          $tmp.Close($false)
          $sheets += @{ name = $ws.Name; csv = [IO.File]::ReadAllText($csvPath); rows = $used.Rows.Count; columns = $used.Columns.Count }
        }
        $out = @{ kind = 'excel'; name = $wb.Name; sheets = @($sheets) }
      } finally { $wb.Close($false) }
    } finally { $app.Quit() }
  }
  default { throw "Unknown kind: $Kind" }
}
[IO.File]::WriteAllText($Json, (ConvertTo-Json $out -Depth 12 -Compress), (New-Object System.Text.UTF8Encoding $false))
`;

export const OFFICE_NOT_SUPPORTED =
  'Office documents are read through the Office desktop apps (PowerPoint, Word, Excel), which needs Windows with Microsoft 365 installed and signed in.';

/** Opens the document in its Office app and returns its content; with `copyTo`, also saves a local copy there. */
export async function extractOfficeDocument(link: OfficeLink, opts: { copyTo?: string; timeoutMs?: number } = {}): Promise<OfficeDocument> {
  if (process.platform !== 'win32') throw new Error(OFFICE_NOT_SUPPORTED);
  const temp = mkdtempSync(join(tmpdir(), 'jirallm-office-'));
  try {
    const script = join(temp, 'extract.ps1');
    const json = join(temp, 'out.json');
    // A BOM makes Windows PowerShell 5.1 read the script as UTF-8.
    writeFileSync(script, '﻿' + OFFICE_EXTRACT_PS1);
    const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Url', link.url, '-Kind', link.kind, '-Json', json, '-TempDir', temp];
    if (opts.copyTo) args.push('-Copy', opts.copyTo);
    await new Promise<void>((resolve, reject) => {
      execFile('powershell.exe', args, { timeout: opts.timeoutMs ?? 180_000, windowsHide: true, maxBuffer: 10 * 1024 * 1024 }, (err, _stdout, stderr) => {
        if (!err) return resolve();
        const detail = stderr.replace(/\s+/g, ' ').trim().slice(0, 600);
        if (/80040154|Class not registered|Retrieving the COM class factory/i.test(detail)) return reject(new Error(OFFICE_NOT_SUPPORTED));
        reject(new Error(`Could not open the ${link.kind} document (are you signed in to Office with access to it?): ${detail || err.message}`));
      });
    });
    return normalizeOfficeDocument(JSON.parse(readFileSync(json, 'utf8').replace(/^﻿/, '')));
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

/** Windows PowerShell unrolls a one-element array returned from a function into the element itself (and an empty one into $null). */
function list<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  return value === null || value === undefined || value === '' ? [] : [value as T];
}

function rows(value: unknown): string[][] {
  const outer = list<unknown>(value);
  // A one-row table comes back as a flat array of cells.
  if (outer.length && !outer.some(Array.isArray)) return [outer.map(String)];
  return outer.map((r) => list<unknown>(r).map(String));
}

export function normalizeOfficeDocument(raw: any): OfficeDocument {
  const name = String(raw?.name ?? 'document');
  if (raw?.kind === 'powerpoint') {
    return {
      kind: 'powerpoint',
      name,
      slides: list<any>(raw.slides).map((s) => ({
        index: Number(s.index),
        hidden: Boolean(s.hidden),
        title: String(s.title ?? ''),
        shapes: list<any>(s.shapes).map((sh) => ({ name: String(sh.name ?? ''), paragraphs: list<unknown>(sh.paragraphs).map(String) })),
        tables: list<unknown>(s.tables).map(rows),
        pictures: Number(s.pictures ?? 0),
        notes: String(s.notes ?? ''),
      })),
    };
  }
  if (raw?.kind === 'word') {
    return {
      kind: 'word',
      name,
      blocks: list<any>(raw.blocks).map((b) =>
        b.type === 'table' ? { type: 'table' as const, rows: rows(b.rows) } : { type: 'paragraph' as const, level: Number(b.level), list: Boolean(b.list), text: String(b.text ?? '') }
      ),
    };
  }
  if (raw?.kind === 'excel') {
    return { kind: 'excel', name, sheets: list<any>(raw.sheets).map((s) => ({ name: String(s.name), csv: String(s.csv ?? ''), rows: Number(s.rows), columns: Number(s.columns) })) };
  }
  throw new Error(`Unexpected document data from Office (kind ${String(raw?.kind)})`);
}

// ---------------------------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------------------------

function cell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n/g, ' ').trim();
}

export function markdownTable(rows: string[][]): string[] {
  const width = Math.max(0, ...rows.map((r) => r.length));
  if (rows.length === 0 || width === 0) return [];
  const pad = (r: string[]) => Array.from({ length: width }, (_, i) => cell(r[i] ?? ''));
  const [head, ...body] = rows;
  return [`| ${pad(head).join(' | ')} |`, `| ${Array(width).fill('---').join(' | ')} |`, ...body.map((r) => `| ${pad(r).join(' | ')} |`)];
}

/** Minimal RFC 4180 parser (quoted fields, doubled quotes, newlines inside quotes). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const MAX_SHEET_ROWS = 500;

function renderSlides(doc: Extract<OfficeDocument, { kind: 'powerpoint' }>): string[] {
  const lines: string[] = [];
  for (const s of doc.slides) {
    const title = s.title || s.shapes[0]?.paragraphs.join(' ') || '';
    lines.push(`## Slide ${s.index}${title ? `: ${title}` : ''}${s.hidden ? ' (hidden)' : ''}`, '');
    const shapes = s.title ? s.shapes : s.shapes.slice(1);
    for (const sh of shapes) {
      if (sh.paragraphs.length === 1) lines.push(`- ${sh.paragraphs[0]}`);
      else if (sh.paragraphs.length > 1) lines.push(`- ${sh.paragraphs[0]}`, ...sh.paragraphs.slice(1).map((p) => `  - ${p}`));
    }
    if (shapes.length) lines.push('');
    for (const t of s.tables) lines.push(...markdownTable(t), '');
    if (s.pictures) lines.push(`_${s.pictures} picture(s)/chart(s) not exported as text_`, '');
    if (s.notes) lines.push('**Notes:**', '', ...s.notes.split('\n').map((n) => `> ${n}`), '');
  }
  return lines;
}

function renderWord(doc: Extract<OfficeDocument, { kind: 'word' }>): string[] {
  const lines: string[] = [];
  for (const b of doc.blocks) {
    if (b.type === 'table') lines.push('', ...markdownTable(b.rows), '');
    // OutlineLevel 1–9 are headings (language independent, unlike style names); 10 is body text.
    else if (b.level >= 1 && b.level <= 9) lines.push('', `${'#'.repeat(Math.min(b.level + 1, 6))} ${b.text}`, '');
    else lines.push(b.list ? `- ${b.text}` : `${b.text}\n`);
  }
  return lines;
}

function renderExcel(doc: Extract<OfficeDocument, { kind: 'excel' }>): string[] {
  const lines: string[] = [];
  for (const sh of doc.sheets) {
    lines.push(`## Sheet: ${sh.name}`, '');
    const rows = parseCsv(sh.csv).filter((r) => r.some((c) => c.trim()));
    if (!rows.length) { lines.push('_(empty)_', ''); continue; }
    lines.push(...markdownTable(rows.slice(0, MAX_SHEET_ROWS)), '');
    if (rows.length > MAX_SHEET_ROWS) lines.push(`_${rows.length - MAX_SHEET_ROWS} more row(s) not shown; open the local copy for all of them_`, '');
  }
  return lines;
}

export function renderOfficeDocument(url: string, doc: OfficeDocument): string {
  const count =
    doc.kind === 'powerpoint' ? `${doc.slides.length} slide(s)` : doc.kind === 'excel' ? `${doc.sheets.length} sheet(s)` : `${doc.blocks.length} block(s)`;
  const body = doc.kind === 'powerpoint' ? renderSlides(doc) : doc.kind === 'word' ? renderWord(doc) : renderExcel(doc);
  const text = [`# ${doc.name}`, '', `${count} · [Open in SharePoint](${url})`, '', ...body].join('\n');
  return text.replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

// ---------------------------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------------------------

function slug(text: string): string {
  return (
    text
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/\.(pptx?|pptm|ppsx|docx?|docm|rtf|xlsx?|xlsm|csv)$/, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) || 'document'
  );
}

const DEFAULT_EXT: Record<OfficeKind, string> = { powerpoint: 'pptx', word: 'docx', excel: 'xlsx' };

export type ExportedOfficeDocument = { dir: string; path: string; copy?: string; title: string; kind: OfficeKind; changed: boolean };

/**
 * Writes `<outputDir>/sharepoint/<site>-<file slug>/document.md` plus the original file next to it
 * (unless `copy: false`). A changed document keeps the previous copy as `.document.previous.md`.
 */
export async function exportOfficeDocument(
  url: string,
  opts: { outputDir: string; copy?: boolean; extract?: typeof extractOfficeDocument }
): Promise<ExportedOfficeDocument> {
  const link = parseOfficeLink(url);
  if (!link) throw new Error(`Not a SharePoint Office document link: ${url}`);
  const extract = opts.extract ?? extractOfficeDocument;
  // The name of a sharing link is only known after opening, so save the copy in a temp spot first.
  const temp = mkdtempSync(join(tmpdir(), 'jirallm-office-copy-'));
  try {
    const tempCopy = opts.copy === false ? undefined : join(temp, `document.${DEFAULT_EXT[link.kind]}`);
    const doc = await extract(link, { copyTo: tempCopy });
    const dir = join(opts.outputDir, 'sharepoint', `${slug(link.site)}-${slug(doc.name)}`);
    mkdirSync(dir, { recursive: true });
    let copy: string | undefined;
    if (tempCopy && existsSync(tempCopy)) {
      const ext = /\.([a-z0-9]+)$/i.exec(doc.name)?.[1] ?? DEFAULT_EXT[link.kind];
      copy = join(dir, `${slug(doc.name)}.${ext.toLowerCase()}`);
      copyFileSync(tempCopy, copy);
    }
    const frontmatter = [
      '---',
      'sharepoint:',
      `  title: ${JSON.stringify(doc.name)}`,
      `  site: ${JSON.stringify(link.site)}`,
      `  kind: ${link.kind}`,
      `  url: ${JSON.stringify(url)}`,
      '---',
      '',
    ].join('\n');
    const path = join(dir, 'document.md');
    const content = frontmatter + renderOfficeDocument(url, doc);
    let changed = true;
    if (existsSync(path)) {
      const old = readFileSync(path, 'utf8');
      changed = old !== content;
      if (changed) copyFileSync(path, join(dir, '.document.previous.md'));
    }
    writeFileSync(path, content);
    return { dir, path, copy, title: doc.name, kind: link.kind, changed };
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}
