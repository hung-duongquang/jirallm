type AttachmentRef = {
    id: string;
    filename: string;
};
export declare function sanitizeAttachmentFilename(name: unknown, id: unknown): string;
export declare function assignAttachmentFilenames(attachments: ReadonlyArray<AttachmentRef>): string[];
export declare function framesDirName(filename: string): string;
export declare function isSafeIssueKey(key: unknown): key is string;
export declare function isPathInside(parent: string, child: string): boolean;
export declare function resolveContainedPath(dir: string, name: string): string;
export declare function entryExists(path: string): boolean;
export declare function isSymlink(path: string): boolean;
export declare function isRegularFile(path: string): boolean;
export declare function isRealDirectory(path: string): boolean;
export declare function isRealPathInside(root: string, path: string): boolean;
export declare function tempPathIn(dir: string): string;
export declare function assertNotSymlink(path: string): void;
export declare function assertRealPathInside(root: string, path: string): void;
export declare function ensureRealDirectory(path: string): void;
export declare function removeEntry(path: string): void;
export declare function writeFileAtomic(path: string, content: string): void;
export declare function writeViaTempFile(target: string, write: (tempPath: string) => Promise<void>): Promise<void>;
export {};
//# sourceMappingURL=safePath.d.ts.map