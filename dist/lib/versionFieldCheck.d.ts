export declare const VERSION_FIELDS: {
    readonly fixVersions: {
        readonly label: "Fix versions";
        readonly noun: "fix version";
        readonly flag: "--fix-versions";
    };
    readonly versions: {
        readonly label: "Affects versions";
        readonly noun: "affects version";
        readonly flag: "--affects-versions";
    };
};
export type VersionFieldId = keyof typeof VERSION_FIELDS;
export type RequestedVersions = Partial<Record<VersionFieldId, string[]>>;
export type ScreenField = {
    fieldId: string;
    allowedValues?: string[];
};
export type ScreenContext = {
    screen: string;
    target: string;
};
export declare function hasRequestedVersions(requested: RequestedVersions): boolean;
/**
 * Which requested version writes Jira would reject, judged from a screen's field metadata
 * (`editmeta` / `createmeta`): the field missing from the screen, or a name that is not one
 * of the screen's allowed values (exact match, as Jira stores it). Query only.
 */
export declare function findVersionFieldProblems(requested: RequestedVersions, screenFields: ScreenField[], context: ScreenContext): string[];
//# sourceMappingURL=versionFieldCheck.d.ts.map