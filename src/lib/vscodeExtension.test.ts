import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { buildVsix, resumeUri, zip } from './vscodeExtension.js';

/** Reads a zip back through its central directory: name → content. */
function unzip(buf: Buffer): Record<string, string> {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  const out: Record<string, string> = {};
  for (let i = 0; i < count; i++) {
    expect(buf.readUInt32LE(at)).toBe(0x02014b50);
    const size = buf.readUInt32LE(at + 20);
    const nameLen = buf.readUInt16LE(at + 28);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.subarray(at + 46, at + 46 + nameLen).toString('utf8');
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = zlib.inflateRawSync(buf.subarray(start, start + size));
    expect(zlib.crc32(data)).toBe(buf.readUInt32LE(at + 16));
    out[name] = data.toString('utf8');
    at += 46 + nameLen;
  }
  return out;
}

describe('zip / buildVsix', () => {
  it('writes entries that read back with matching checksums', () => {
    expect(unzip(zip([['a.txt', Buffer.from('hello')], ['dir/b.json', Buffer.from('{"x":1}')]]))).toEqual({ 'a.txt': 'hello', 'dir/b.json': '{"x":1}' });
  });

  it('packs the extension with a manifest naming its id and version', () => {
    const files = unzip(buildVsix());
    expect(Object.keys(files).sort()).toEqual(['[Content_Types].xml', 'extension.vsixmanifest', 'extension/extension.js', 'extension/package.json']);
    const pkg = JSON.parse(files['extension/package.json']!) as { version: string };
    expect(files['extension.vsixmanifest']).toContain(`Id="jirallm-sessions" Version="${pkg.version}" Publisher="jirallm"`);
  });
});

describe('resumeUri', () => {
  it('encodes the session, folder and title as query parameters', () => {
    const uri = resumeUri('abc-1', 'C:/my work', 'PR #3151 & more');
    expect(uri.startsWith('vscode://jirallm.jirallm-sessions/resume?')).toBe(true);
    const q = new URL(uri).searchParams;
    expect([q.get('id'), q.get('cwd'), q.get('title')]).toEqual(['abc-1', 'C:/my work', 'PR #3151 & more']);
  });
});
