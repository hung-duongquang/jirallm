import { randomBytes } from 'crypto';
import { lstatSync, mkdirSync, realpathSync, renameSync, rmSync, writeFileSync, } from 'fs';
import { dirname, isAbsolute, join, relative, sep } from 'path';
import { parseIssueKey } from '../cli/issueKey.js';
import { stripControlChars } from './untrusted.js';
const MAX_FILENAME_BYTES = 180;
const MAX_EXTENSION_LENGTH = 16;
const MAX_FALLBACK_ID_LENGTH = 32;
const TEMP_SUFFIX_BYTES = 8;
const FRAMES_SUFFIX = '-frames';
const PATH_SEPARATORS = /[/\\]/;
const INVALID_FILENAME_CHARS = /[<>:"|?*%]/g;
const TRAILING_DOTS_AND_SPACES = /[. ]+$/;
const UNSAFE_ID_CHARS = /[^A-Za-z0-9_-]/g;
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])$/i;
const MISSING_ENTRY_CODES = ['ENOENT', 'ENOTDIR'];
const byteLength = (value) => Buffer.byteLength(value, 'utf8');
const lastSegment = (name) => name.split(PATH_SEPARATORS).pop() ?? '';
const stripTrailingDotsAndSpaces = (name) => name.replace(TRAILING_DOTS_AND_SPACES, '');
const replaceInvalidChars = (name) => name.replace(INVALID_FILENAME_CHARS, '_');
const fallbackName = (id) => {
    const safeId = String(id ?? '')
        .replace(UNSAFE_ID_CHARS, '')
        .slice(0, MAX_FALLBACK_ID_LENGTH);
    return `attachment-${safeId || 'unknown'}`;
};
function splitExtension(name) {
    const dot = name.lastIndexOf('.');
    if (dot <= 0 || name.length - dot - 1 > MAX_EXTENSION_LENGTH)
        return { stem: name, ext: '' };
    return { stem: name.slice(0, dot), ext: name.slice(dot) };
}
function truncateToBytes(value, maxBytes) {
    let out = '';
    for (const ch of value) {
        if (byteLength(out + ch) > maxBytes)
            return out;
        out += ch;
    }
    return out;
}
function capLength(name) {
    if (byteLength(name) <= MAX_FILENAME_BYTES)
        return name;
    const { stem, ext } = splitExtension(name);
    const stemBudget = MAX_FILENAME_BYTES - byteLength(ext);
    const truncated = stripTrailingDotsAndSpaces(truncateToBytes(stem, stemBudget));
    return `${truncated || 'attachment'}${ext}`;
}
function neutraliseReservedName(name) {
    const base = name.split('.')[0].trimEnd();
    return WINDOWS_RESERVED_NAME.test(base) ? `_${name}` : name;
}
export function sanitizeAttachmentFilename(name, id) {
    const raw = typeof name === 'string' ? name.normalize('NFC') : '';
    const cleaned = stripTrailingDotsAndSpaces(replaceInvalidChars(lastSegment(stripControlChars(raw))).trimStart());
    if (!cleaned)
        return fallbackName(id);
    return capLength(neutraliseReservedName(cleaned));
}
const collisionKey = (name) => name.normalize('NFKD').toUpperCase().toLowerCase();
const withCounter = (name, counter) => {
    const { stem, ext } = splitExtension(name);
    return `${stem}-${counter}${ext}`;
};
const isNameFree = (used, candidate) => !used.has(collisionKey(candidate)) && !used.has(collisionKey(`${candidate}${FRAMES_SUFFIX}`));
function pickFreeName(used, base) {
    if (isNameFree(used, base))
        return base;
    for (let counter = 1;; counter++) {
        const candidate = withCounter(base, counter);
        if (isNameFree(used, candidate))
            return candidate;
    }
}
export function assignAttachmentFilenames(attachments) {
    const used = new Set();
    return attachments.map((att) => {
        const name = pickFreeName(used, sanitizeAttachmentFilename(att.filename, att.id));
        used.add(collisionKey(name));
        used.add(collisionKey(`${name}${FRAMES_SUFFIX}`));
        return name;
    });
}
export function framesDirName(filename) {
    return `${filename}${FRAMES_SUFFIX}`;
}
export function isSafeIssueKey(key) {
    if (typeof key !== 'string' || key.includes('/'))
        return false;
    try {
        return parseIssueKey(key).key === key;
    }
    catch {
        return false;
    }
}
export function isPathInside(parent, child) {
    const rel = relative(parent, child);
    if (rel === '' || isAbsolute(rel))
        return false;
    return rel !== '..' && !rel.startsWith(`..${sep}`);
}
export function resolveContainedPath(dir, name) {
    const target = join(dir, name);
    if (!isPathInside(dir, target)) {
        throw new Error(`Refusing to write outside ${dir}: ${JSON.stringify(name)}`);
    }
    return target;
}
const isMissingEntryError = (error) => error instanceof Error &&
    'code' in error &&
    MISSING_ENTRY_CODES.some((code) => code === error.code);
function lstatOrUndefined(path) {
    try {
        return lstatSync(path);
    }
    catch (error) {
        if (isMissingEntryError(error))
            return undefined;
        throw error;
    }
}
export function entryExists(path) {
    return lstatOrUndefined(path) !== undefined;
}
export function isSymlink(path) {
    return lstatOrUndefined(path)?.isSymbolicLink() ?? false;
}
export function isRegularFile(path) {
    return lstatOrUndefined(path)?.isFile() ?? false;
}
export function isRealDirectory(path) {
    return lstatOrUndefined(path)?.isDirectory() ?? false;
}
export function isRealPathInside(root, path) {
    return isPathInside(realpathSync(root), realpathSync(path));
}
export function tempPathIn(dir) {
    return join(dir, `.jirallm-${randomBytes(TEMP_SUFFIX_BYTES).toString('hex')}.tmp`);
}
export function assertNotSymlink(path) {
    if (isSymlink(path))
        throw new Error(`Refusing to write through symlink: ${path}`);
}
export function assertRealPathInside(root, path) {
    if (!isRealPathInside(root, path)) {
        throw new Error(`Refusing to write outside ${root}: ${path} resolves elsewhere`);
    }
}
export function ensureRealDirectory(path) {
    assertNotSymlink(path);
    if (!entryExists(path))
        mkdirSync(path);
    if (!isRealDirectory(path))
        throw new Error(`Refusing to write: ${path} is not a directory`);
}
export function removeEntry(path) {
    rmSync(path, { recursive: true, force: true });
}
export function writeFileAtomic(path, content) {
    assertNotSymlink(path);
    const tmp = tempPathIn(dirname(path));
    try {
        writeFileSync(tmp, content, { encoding: 'utf-8', flag: 'wx' });
        renameSync(tmp, path);
    }
    catch (error) {
        removeEntry(tmp);
        throw error;
    }
}
export async function writeViaTempFile(target, write) {
    assertNotSymlink(target);
    const tmp = tempPathIn(dirname(target));
    removeEntry(tmp);
    try {
        await write(tmp);
        assertNotSymlink(target);
        renameSync(tmp, target);
    }
    catch (error) {
        removeEntry(tmp);
        throw error;
    }
}
//# sourceMappingURL=safePath.js.map