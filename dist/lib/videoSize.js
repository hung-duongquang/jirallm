import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolveFfmpegBinary } from 'framewise';
const execFileAsync = promisify(execFile);
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
const DIMENSIONS_PATTERN = /,\s(\d{2,5})x(\d{2,5})(?:[\s,[]|$)/m;
let cachedFfprobePath;
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
            await execFileAsync(candidate, ['-version']);
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
async function probeWithFfmpeg(filePath) {
    const ffmpeg = await resolveFfmpegBinary().catch(() => null);
    if (!ffmpeg)
        return undefined;
    try {
        const { stderr } = await execFileAsync(ffmpeg, ['-hide_banner', '-i', filePath]);
        return parseFfmpegStderrSize(stderr);
    }
    catch (error) {
        const stderr = error.stderr;
        return typeof stderr === 'string' ? parseFfmpegStderrSize(stderr) : undefined;
    }
}
/** Reads a video's pixel dimensions via ffprobe, falling back to parsing `ffmpeg -i` output. */
export async function readVideoSize(filePath) {
    const ffprobe = await resolveFfprobeBinary();
    if (ffprobe) {
        try {
            const { stdout } = await execFileAsync(ffprobe, [...PROBE_ARGS, filePath]);
            const size = parseFfprobeSize(stdout);
            if (size)
                return size;
        }
        catch {
            // fall through to the ffmpeg-based probe
        }
    }
    return probeWithFfmpeg(filePath);
}
export const __test = {
    resetFfprobeCache: () => {
        cachedFfprobePath = undefined;
    },
};
//# sourceMappingURL=videoSize.js.map