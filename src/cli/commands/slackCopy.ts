import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cfHtml, toSlackHtml, toSlackText } from '../../lib/slackFormat.js';

export type SlackCopyOptions = { print?: boolean };

function run(cmd: string, args: string[], input?: string): string {
  const r = spawnSync(cmd, args, { encoding: 'utf8', input, windowsHide: true });
  if (r.error || r.status !== 0) throw new Error(`${cmd} failed: ${r.error?.message ?? r.stderr?.trim() ?? `exit ${r.status}`}`);
  return r.stdout;
}

/** Runs a Windows PowerShell script in STA mode (the clipboard needs it), passing text through UTF-8 files. */
function powershell(script: string, files: Record<string, string> = {}): Record<string, string> {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'jirallm-clip-'));
  try {
    const paths: Record<string, string> = {};
    for (const [name, text] of Object.entries(files)) writeFileSync((paths[name] = path.join(dir, name)), text, 'utf8');
    const out = path.join(dir, 'out.txt');
    const vars = Object.entries({ ...paths, out }).map(([k, v]) => `$${k.replace(/\W/g, '_')} = '${v.replace(/'/g, "''")}'`).join('; ');
    run('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-Command', `${vars}; ${script}`]);
    let result = '';
    try {
      result = readFileSync(out, 'utf8');
    } catch {
      // The script wrote nothing back.
    }
    return { out: result };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Every non-ASCII character as a numeric HTML entity. */
export const asciiHtml = (html: string) => html.replace(/[^\t\n\r -~]/gu, (c) => `&#${c.codePointAt(0)};`);

export function readClipboard(): string {
  if (process.platform === 'win32') {
    return powershell(`$t = Get-Clipboard -Raw; if ($null -eq $t) { $t = '' }; [IO.File]::WriteAllText($out, $t, [Text.UTF8Encoding]::new($false))`).out!;
  }
  if (process.platform === 'darwin') return run('pbpaste', []);
  try {
    return run('wl-paste', ['--no-newline']);
  } catch {
    return run('xclip', ['-selection', 'clipboard', '-o']);
  }
}

/**
 * Puts the text on the clipboard. On Windows as rich text (HTML) too, which Slack keeps when it is
 * pasted (bold, lists, links, code); elsewhere as plain text in Slack's own markup.
 */
export function writeClipboard(text: string, html: string): 'rich' | 'plain' {
  if (process.platform === 'win32') {
    powershell(
      'Add-Type -AssemblyName System.Windows.Forms; $u = [Text.UTF8Encoding]::new($false); ' +
        '$d = New-Object System.Windows.Forms.DataObject; ' +
        '$d.SetData([System.Windows.Forms.DataFormats]::Html, [IO.File]::ReadAllText($html_txt, $u)); ' +
        '$d.SetData([System.Windows.Forms.DataFormats]::UnicodeText, [IO.File]::ReadAllText($text_txt, $u)); ' +
        '[System.Windows.Forms.Clipboard]::SetDataObject($d, $true)',
      // Windows PowerShell stores "HTML Format" in the ANSI code page (→ became "?"), so the HTML goes as ASCII with entities.
      { 'html.txt': cfHtml(asciiHtml(html)), 'text.txt': text }
    );
    return 'rich';
  }
  if (process.platform === 'darwin') run('pbcopy', [], text);
  else {
    try {
      run('wl-copy', [], text);
    } catch {
      run('xclip', ['-selection', 'clipboard'], text);
    }
  }
  return 'plain';
}

/** Piped stdin, or '' when nothing arrives soon (a pipe some runners leave open without writing to it). */
function readStdin(waitMs = 300): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    const done = () => {
      clearTimeout(idle);
      process.stdin.pause();
      resolve(Buffer.concat(chunks).toString('utf8'));
    };
    const idle = setTimeout(done, waitMs);
    process.stdin.on('data', (c: Buffer) => {
      clearTimeout(idle);
      chunks.push(c);
    });
    process.stdin.on('end', done);
    process.stdin.on('error', done);
  });
}

/** `jirallm slack:copy [file]`: from a file, piped stdin, or else the clipboard, back to the clipboard Slack-ready. */
export async function runSlackCopy(file: string | undefined, opts: SlackCopyOptions): Promise<void> {
  // Stdin is not a terminal under `! jirallm slack:copy` in Claude Code or a task runner either, but
  // empty there: only text actually piped in replaces the clipboard.
  const piped = file || process.stdin.isTTY ? '' : await readStdin();
  const input = file ? readFileSync(file, 'utf8') : piped.trim() ? piped : readClipboard();
  if (!input.trim()) throw new Error(file ? `${file} is empty` : 'Nothing to convert: copy the text first (or pass a file / pipe it in).');
  const text = toSlackText(input);
  if (opts.print) {
    console.log(text);
    return;
  }
  const how = writeClipboard(text, toSlackHtml(input));
  console.log(text);
  console.log(`\n✓ Copied for Slack (${how === 'rich' ? 'rich text: paste with Ctrl+V' : 'plain text in Slack markup'}).`);
}
