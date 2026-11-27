import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolveFfmpegBinary } from './framewise.js';
const execFileAsync = promisify(execFile);
export const PROBE_TIMEOUT_MS = 15_000;
const PROBE_EXEC_OPTIONS = { timeout: PROBE_TIMEOUT_MS };
const PROBE_ARGS = [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=width,height',
    '-of',
    'json',
];
const DURATION_PROBE_ARGS = ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json'];
const DIMENSIONS_PATTERN = /,\s(\d{2,5})x(\d{2,5})(?:[\s,[]|$)/m;
const DURATION_PATTERN = /^\s*Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?),/m;
let cachedFfprobePath;
const isRecord = (value) => typeof value === 'object' && value !== null;
function ffprobeCandidates(ffmpegPath) {
    const swapped = ffmpegPath?.replace(/ffmpeg(\.exe)?$/i, 'ffprobe$1');
    return swapped && swapped !== ffmpegPath ? [swapped, 'ffprobe'] : ['ffprobe'];
}
export async function resolveFfprobeBinary() {
    if (cachedFfprobePath !== undefined)
        return cachedFfprobePath;
    const ffmpeg = await resolveFfmpegBinary().catch(() => null);
    for (const candidate of ffprobeCandidates(ffmpeg)) {
        try {
            await execFileAsync(candidate, ['-version'], PROBE_EXEC_OPTIONS);
            cachedFfprobePath = candidate;
            return cachedFfprobePath;
        }
        catch {
            continue;
        }
    }
    cachedFfprobePath = null;
    return cachedFfprobePath;
}
export function parseFfprobeSize(stdout) {
    try {
        const parsed = JSON.parse(stdout);
        const stream = parsed.streams?.[0];
        const { width, height } = stream ?? {};
        if (typeof width !== 'number' || typeof height !== 'number')
            return undefined;
        if (width <= 0 || height <= 0)
            return undefined;
        return { width, height };
    }
    catch {
        return undefined;
    }
}
export function parseFfmpegStderrSize(stderr) {
    const match = DIMENSIONS_PATTERN.exec(stderr);
    if (!match)
        return undefined;
    return { width: Number(match[1]), height: Number(match[2]) };
}
const validDuration = (seconds) => Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
function parseJson(text) {
    try {
        return JSON.parse(text);
    }
    catch {
        return undefined;
    }
}
export function parseFfprobeDuration(stdout) {
    const parsed = parseJson(stdout);
    const format = isRecord(parsed) ? parsed.format : undefined;
    const duration = isRecord(format) ? format.duration : undefined;
    if (typeof duration === 'number')
        return validDuration(duration);
    if (typeof duration !== 'string' || duration.trim() === '')
        return undefined;
    return validDuration(Number(duration));
}
export function parseFfmpegStderrDuration(stderr) {
    const match = DURATION_PATTERN.exec(stderr);
    if (!match)
        return undefined;
    return validDuration(Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]));
}
const stderrOf = (error) => isRecord(error) && typeof error.stderr === 'string' ? error.stderr : undefined;
async function readFfmpegInfo(filePath) {
    const ffmpeg = await resolveFfmpegBinary().catch(() => null);
    if (!ffmpeg)
        return undefined;
    try {
        const { stderr } = await execFileAsync(ffmpeg, ['-hide_banner', '-i', filePath], PROBE_EXEC_OPTIONS);
        return stderr;
    }
    catch (error) {
        return stderrOf(error) ?? '';
    }
}
async function runFfprobe(ffprobe, args) {
    try {
        const { stdout } = await execFileAsync(ffprobe, [...args], PROBE_EXEC_OPTIONS);
        return stdout;
    }
    catch {
        return undefined;
    }
}
async function probeWithFfmpeg(filePath) {
    const stderr = await readFfmpegInfo(filePath);
    return stderr === undefined ? undefined : parseFfmpegStderrSize(stderr);
}
/** Reads a video's pixel dimensions via ffprobe, falling back to parsing `ffmpeg -i` output. */
export async function readVideoSize(filePath) {
    const ffprobe = await resolveFfprobeBinary();
    const stdout = ffprobe ? await runFfprobe(ffprobe, [...PROBE_ARGS, filePath]) : undefined;
    const size = stdout === undefined ? undefined : parseFfprobeSize(stdout);
    return size ?? probeWithFfmpeg(filePath);
}
export async function readVideoDuration(filePath) {
    const ffprobe = await resolveFfprobeBinary();
    const stdout = ffprobe ? await runFfprobe(ffprobe, [...DURATION_PROBE_ARGS, filePath]) : undefined;
    const probed = stdout === undefined ? undefined : parseFfprobeDuration(stdout);
    if (probed !== undefined)
        return { status: 'known', seconds: probed };
    const stderr = await readFfmpegInfo(filePath);
    if (stderr === undefined)
        return ffprobe ? { status: 'unknown' } : { status: 'unavailable' };
    const fromFfmpeg = parseFfmpegStderrDuration(stderr);
    return fromFfmpeg === undefined ? { status: 'unknown' } : { status: 'known', seconds: fromFfmpeg };
}
export const __test = {
    resetFfprobeCache: () => {
        cachedFfprobePath = undefined;
    },
};
//# sourceMappingURL=videoSize.js.map