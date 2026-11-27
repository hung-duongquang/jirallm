const load = () => import('framewise');
export const extractFrames = async (...args) => (await load()).extractFrames(...args);
export const checkFfmpeg = async (...args) => (await load()).checkFfmpeg(...args);
export const resolveFfmpegBinary = async (...args) => (await load()).resolveFfmpegBinary(...args);
/** framewise's VIDEO_EXTENSIONS. */
const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.avi', '.webm', '.mkv', '.m4v', '.flv', '.wmv', '.mpg', '.mpeg'];
export function isVideoFile(filename) {
    const lower = filename.toLowerCase();
    return VIDEO_EXTENSIONS.some((ext) => lower.endsWith(ext));
}
//# sourceMappingURL=framewise.js.map