/**
 * The small VS Code extension that ships with jirallm (`vscode/`): it opens `vscode://jirallm.jirallm-sessions/resume?…`
 * links as a terminal in the VS Code window, so `jirallm ui`'s Resume button brings a session back
 * where the user works instead of in a separate terminal window. Packed into a .vsix here (a zip
 * with a manifest) and installed with `code --install-extension`, so no packaging tool is needed.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

export const EXTENSION_ID = 'jirallm.jirallm-sessions';
const sourceDir = () => fileURLToPath(new URL('../../vscode/', import.meta.url));
const FILES = ['package.json', 'extension.js'];

export function extensionVersion(dir = sourceDir()): string {
  return (JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')) as { version: string }).version;
}

/** A zip archive (deflated entries) of name → content. */
export function zip(entries: Array<[string, Buffer]>): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const packed = zlib.deflateRawSync(data);
    const crc = zlib.crc32(data);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(0x0800, 6); // UTF-8 names
    head.writeUInt16LE(8, 8); // deflate
    head.writeUInt16LE(0x21, 12); // 1980-01-01
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(packed.length, 18);
    head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(nameBuf.length, 26);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0x0800, 8);
    dir.writeUInt16LE(8, 10);
    dir.writeUInt16LE(0x21, 14);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(packed.length, 20);
    dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(nameBuf.length, 28);
    dir.writeUInt32LE(offset, 42);
    local.push(head, nameBuf, packed);
    central.push(dir, nameBuf);
    offset += head.length + nameBuf.length + packed.length;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, centralBuf, end]);
}

/** The extension as a .vsix: the files under extension/, plus the manifest VS Code reads. */
export function buildVsix(dir = sourceDir()): Buffer {
  const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')) as {
    name: string;
    publisher: string;
    version: string;
    displayName: string;
    description: string;
    engines: { vscode: string };
  };
  const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const manifest = `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata>
    <Identity Language="en-US" Id="${xml(pkg.name)}" Version="${xml(pkg.version)}" Publisher="${xml(pkg.publisher)}" />
    <DisplayName>${xml(pkg.displayName)}</DisplayName>
    <Description xml:space="preserve">${xml(pkg.description)}</Description>
    <Categories>Other</Categories>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="${xml(pkg.engines.vscode)}" />
    </Properties>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code" />
  </Installation>
  <Dependencies />
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
  </Assets>
</PackageManifest>
`;
  const types =
    '<?xml version="1.0" encoding="utf-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension=".json" ContentType="application/json" /><Default Extension=".js" ContentType="application/javascript" />' +
    '<Default Extension=".vsixmanifest" ContentType="text/xml" /></Types>';
  return zip([
    ['[Content_Types].xml', Buffer.from(types)],
    ['extension.vsixmanifest', Buffer.from(manifest)],
    ...FILES.map((f): [string, Buffer] => [`extension/${f}`, readFileSync(path.join(dir, f))]),
  ]);
}

const extensionsDir = () => process.env.VSCODE_EXTENSIONS || path.join(os.homedir(), '.vscode', 'extensions');

/** Whether this version of the extension is installed (VS Code unpacks it to <id>-<version>[-platform]). */
export function extensionInstalled(version = extensionVersion()): boolean {
  try {
    return readdirSync(extensionsDir()).some((d) => d.toLowerCase().startsWith(`${EXTENSION_ID}-${version}`));
  } catch {
    return false;
  }
}

/** Runs VS Code's `code` command line (a .cmd script on Windows, so through cmd.exe with each argument quoted). */
function code(args: string[], timeout: number) {
  const opts = { encoding: 'utf8' as const, windowsHide: true, timeout };
  if (process.platform !== 'win32') return spawnSync('code', args, opts);
  const line = ['code', ...args.map((a) => `"${a.replace(/"/g, '')}"`)].join(' ');
  return spawnSync('cmd.exe', ['/d', '/s', '/c', `"${line}"`], { ...opts, windowsVerbatimArguments: true });
}

/** The `code` command line, if VS Code is installed. */
export function hasCodeCli(): boolean {
  return code(['--version'], 15000).status === 0;
}

/** Installs (or updates) the extension; returns an error message, or '' when it is installed. */
export function installExtension(): string {
  if (extensionInstalled()) return '';
  if (!hasCodeCli()) return 'VS Code\'s "code" command was not found.';
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'jirallm-vsix-'));
  try {
    const file = path.join(tmp, `jirallm-sessions-${extensionVersion()}.vsix`);
    writeFileSync(file, buildVsix());
    const r = code(['--install-extension', file, '--force'], 60000);
    if (r.status !== 0) return `code --install-extension failed: ${(r.stderr || r.stdout || '').trim().split('\n').pop()}`;
    return extensionInstalled() ? '' : 'The extension did not show up after installing it.';
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

export function resumeUri(id: string, cwd: string, title: string): string {
  const q = new URLSearchParams({ id, cwd, title });
  return `vscode://${EXTENSION_ID}/resume?${q.toString()}`;
}

/**
 * Code.exe on Windows: the program the vscode:// link handler names in the registry, else the
 * per-user install. (explorer.exe drops such links, and code.cmd cuts them at the "&".)
 */
function codeExe(): string | undefined {
  for (const root of ['HKCU', 'HKLM']) {
    const r = spawnSync('reg', ['query', `${root}\\Software\\Classes\\vscode\\shell\\open\\command`, '/ve'], { encoding: 'utf8', windowsHide: true });
    const exe = /"([^"]+\.exe)"/i.exec(r.stdout ?? '')?.[1];
    if (exe && existsSync(exe)) return exe;
  }
  const local = process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'Code.exe');
  return local && existsSync(local) ? local : undefined;
}

/** Hands the link to VS Code, with no shell in between to parse the "&". */
export function openUri(uri: string): void {
  const exe = process.platform === 'win32' ? codeExe() : undefined;
  const [cmd, args] = exe
    ? [exe, ['--open-url', '--', uri]]
    : process.platform === 'win32'
      ? ['explorer.exe', [uri]]
      : process.platform === 'darwin'
        ? ['open', [uri]]
        : ['xdg-open', [uri]];
  const child = spawn(cmd, args as string[], { detached: true, stdio: 'ignore' });
  child.on('error', () => {});
  child.unref();
}

/** Whether `vscode/` ships with this install (it does from the release package). */
export const extensionAvailable = () => existsSync(path.join(sourceDir(), 'package.json'));
