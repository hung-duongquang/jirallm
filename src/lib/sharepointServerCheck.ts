import { inflateRawSync } from 'node:zlib';
import type { SharePointClient } from './sharepoint.js';

/**
 * Checks an edit against SharePoint itself rather than Office's local cache: PowerPoint's save
 * goes to the Office Document Cache and uploads in the background, so reopening the deck through
 * PowerPoint can show a change that never reached the server.
 */

/** Reads the entries of a zip (a .pptx) whose names pass `filter`, using only node:zlib. */
export function readZipEntries(zip: Buffer, filter: (name: string) => boolean): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  // End of central directory: signature 0x06054b50, searched from the end (comment up to 64 KB).
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Not a zip file (no end of central directory).');
  const count = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) throw new Error('Corrupt zip central directory.');
    const method = zip.readUInt16LE(p + 10);
    const compressed = zip.readUInt32LE(p + 20);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const local = zip.readUInt32LE(p + 42);
    const name = zip.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (!filter(name)) continue;
    const dataStart = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const data = zip.subarray(dataStart, dataStart + compressed);
    if (method === 0) out.set(name, Buffer.from(data));
    else if (method === 8) out.set(name, inflateRawSync(data));
  }
  return out;
}

function decodeXml(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}

/** Every paragraph of text on the slides and notes of a .pptx (runs joined, `<a:br/>` as a newline). */
export function pptxParagraphs(pptx: Buffer): string[] {
  const parts = readZipEntries(pptx, (n) => /^ppt\/(slides\/slide|notesSlides\/notesSlide)\d+\.xml$/.test(n));
  const paragraphs: string[] = [];
  for (const xml of parts.values()) {
    for (const p of xml.toString('utf8').match(/<a:p>[\s\S]*?<\/a:p>|<a:p [\s\S]*?<\/a:p>/g) ?? []) {
      const text = (p.match(/<a:t>[^<]*<\/a:t>|<a:br\/>|<a:br [^>]*\/>/g) ?? [])
        .map((t) => (t.startsWith('<a:br') ? '\n' : decodeXml(t.slice(5, -6))))
        .join('');
      if (text.trim()) paragraphs.push(text);
    }
  }
  return paragraphs;
}

export type ServerFileInfo = { modified: string; version: string };

/** `https://<tenant>.sharepoint.com/sites/<site>/<library>/<file>` → its site URL and server-relative path. */
export function splitDocumentUrl(fullName: string): { site: string; path: string } | undefined {
  try {
    const u = new URL(fullName);
    const path = decodeURIComponent(u.pathname);
    const site = /^\/(?:sites|teams)\/[^/]+/.exec(path)?.[0];
    return site ? { site: u.origin + encodeURI(site), path } : undefined;
  } catch {
    return undefined;
  }
}

function fileApi(site: string, path: string, suffix: string): string {
  return `${site}/_api/web/GetFileByServerRelativePath(decodedurl=@u)${suffix}${suffix.includes('?') ? '&' : '?'}@u=${encodeURIComponent(`'${path.replace(/'/g, "''")}'`)}`;
}

export async function serverFileInfo(client: SharePointClient, fullName: string): Promise<ServerFileInfo> {
  const doc = splitDocumentUrl(fullName);
  if (!doc) throw new Error(`Not a SharePoint document URL: ${fullName}`);
  const info = await client.json<{ TimeLastModified: string; UIVersionLabel: string }>(fileApi(doc.site, doc.path, '?$select=TimeLastModified,UIVersionLabel'));
  return { modified: info.TimeLastModified, version: info.UIVersionLabel };
}

export async function downloadServerFile(client: SharePointClient, fullName: string): Promise<Buffer> {
  const doc = splitDocumentUrl(fullName);
  if (!doc) throw new Error(`Not a SharePoint document URL: ${fullName}`);
  return client.download(fileApi(doc.site, doc.path, '/$value'));
}

/** What a change should have left in the deck: lines that must be there, and text that must be gone. */
export type Expectation = { present: string[]; absent: string[] };

export function expectations(results: { target: string; before: string; after: string }[]): Expectation[] {
  return results.map((r) => {
    const present = r.after.split('\n').map((l) => l.trim()).filter(Boolean);
    // A find edit removes its text unless the replacement still contains it ("Hung" -> "Hung Duong").
    const absent = r.target === 'find' && r.before && !r.after.includes(r.before) ? [r.before] : [];
    return { present, absent };
  });
}

/** True per expectation when every present line is inside some paragraph and no absent text is. */
export function expectationsMet(paragraphs: string[], list: Expectation[]): boolean[] {
  const flat = paragraphs.map((p) => p.replace(/\s+/g, ' '));
  const norm = (s: string) => s.replace(/\s+/g, ' ');
  return list.map(
    (e) => e.present.every((l) => flat.some((p) => p.includes(norm(l)))) && e.absent.every((t) => !flat.some((p) => p.includes(norm(t))))
  );
}

export type ServerCheck = { verified: boolean[]; info?: ServerFileInfo; timedOut: boolean };

/**
 * Polls SharePoint until its copy of the file meets every expectation, or until `timeoutMs`.
 * Content decides, not timestamps: an edit that changed nothing makes no new version but is still
 * on the server. The file is downloaded again only when the server version changes.
 */
export async function waitForServerContent(
  client: SharePointClient,
  fullName: string,
  list: Expectation[],
  opts: { timeoutMs?: number; intervalMs?: number; sleep?: (ms: number) => Promise<void> } = {}
): Promise<ServerCheck> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const deadline = Date.now() + (opts.timeoutMs ?? 120_000);
  let verified = list.map(() => false);
  let info: ServerFileInfo | undefined;
  let checked: string | undefined;
  for (;;) {
    info = await serverFileInfo(client, fullName);
    const key = `${info.version}|${info.modified}`;
    if (key !== checked) {
      checked = key;
      verified = expectationsMet(pptxParagraphs(await downloadServerFile(client, fullName)), list);
      if (verified.every(Boolean)) return { verified, info, timedOut: false };
    }
    if (Date.now() >= deadline) return { verified, info, timedOut: true };
    await sleep(opts.intervalMs ?? 5_000);
  }
}
