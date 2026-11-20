import type { ImageSize } from './imageSize.js';
export declare const PROBE_TIMEOUT_MS = 15000;
export type VideoDurationProbe = {
    status: 'known';
    seconds: number;
} | {
    status: 'unknown';
} | {
    status: 'unavailable';
};
export declare function resolveFfprobeBinary(): Promise<string | null>;
export declare function parseFfprobeSize(stdout: string): ImageSize | undefined;
export declare function parseFfmpegStderrSize(stderr: string): ImageSize | undefined;
export declare function parseFfprobeDuration(stdout: string): number | undefined;
export declare function parseFfmpegStderrDuration(stderr: string): number | undefined;
/** Reads a video's pixel dimensions via ffprobe, falling back to parsing `ffmpeg -i` output. */
export declare function readVideoSize(filePath: string): Promise<ImageSize | undefined>;
export declare function readVideoDuration(filePath: string): Promise<VideoDurationProbe>;
export declare const __test: {
    resetFfprobeCache: () => void;
};
//# sourceMappingURL=videoSize.d.ts.map