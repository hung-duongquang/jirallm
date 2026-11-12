import type { RequestedVersions, ScreenContext, ScreenField } from '../lib/versionFieldCheck.js';
type ScreenCheck = {
    load: () => Promise<ScreenField[]>;
    context: ScreenContext;
    remedy: string;
};
/**
 * Abort before any write when Jira would reject a version flag: the field is not on the
 * screen for this operation, or a name is not one of its allowed values. If the screen
 * metadata can't be read (e.g. permissions), warn and proceed — the write may still work.
 */
export declare function assertVersionsSettable(requested: RequestedVersions, { load, context, remedy }: ScreenCheck): Promise<void>;
export declare function nonEmptyOrUndefined(names: string[] | undefined): string[] | undefined;
export {};
//# sourceMappingURL=versionScreen.d.ts.map