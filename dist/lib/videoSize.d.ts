import type { ImageSize } from './imageSize.js';
export declare function resolveFfprobeBinary(): Promise<string | null>;
export declare function parseFfprobeSize(stdout: string): ImageSize | undefined;
export declare function parseFfmpegStderrSize(stderr: string): ImageSize | undefined;
/** Reads a video's pixel dimensions via ffprobe, falling back to parsing `ffmpeg -i` output. */
export declare function readVideoSize(filePath: string): Promise<ImageSize | undefined>;
export declare const __test: {
    resetFfprobeCache: () => void;
};
//# sourceMappingURL=videoSize.d.ts.map