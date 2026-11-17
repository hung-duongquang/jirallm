// framewise loads sharp (a native image library) as soon as it is imported, and Windows locks a loaded
// DLL until the process ends. Long-running commands (`jirallm resume`, `watch`, `changes --follow`)
// then made `npm install -g` of a new version fail with EBUSY. So framewise is loaded only when a
// video's frames are extracted or ffmpeg is probed; the extension check needs no import of it at all.
import type * as Framewise from 'framewise';

const load = (): Promise<typeof Framewise> => import('framewise');

export const extractFrames: typeof Framewise.extractFrames = async (...args) => (await load()).extractFrames(...args);
export const checkFfmpeg: typeof Framewise.checkFfmpeg = async (...args) => (await load()).checkFfmpeg(...args);
export const resolveFfmpegBinary: typeof Framewise.resolveFfmpegBinary = async (...args) =>
  (await load()).resolveFfmpegBinary(...args);

/** framewise's VIDEO_EXTENSIONS. */
const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.avi', '.webm', '.mkv', '.m4v', '.flv', '.wmv', '.mpg', '.mpeg'];

export function isVideoFile(filename: string): boolean {
  const lower = filename.toLowerCase();
  return VIDEO_EXTENSIONS.some((ext) => lower.endsWith(ext));
}
