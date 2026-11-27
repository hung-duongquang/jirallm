import { type Raw } from './sharepointOffice.js';
import { SharePointClient } from './sharepoint.js';
/**
 * Edits a PowerPoint deck on SharePoint in place through PowerPoint (COM), with the user's own
 * Office sign-in. Formatting is kept: text is replaced paragraph by paragraph, so each paragraph
 * keeps its bullet, size and colour, and added paragraphs take the format of the last one.
 */
export type SlideEdit = 
/** Replace all text of a shape (found by name, as `jirallm sharepoint` shows it); lines become paragraphs. */
{
    slide: number;
    shape: string;
    text: string;
}
/** Replace the speaker notes of a slide. */
 | {
    slide: number;
    notes: string;
}
/** Replace every occurrence of `find` in the text of a slide (or of every slide without `slide`). */
 | {
    slide?: number;
    find: string;
    replace: string;
};
export type EditResult = {
    slide: number | null;
    target: string;
    before: string;
    after: string;
    count?: number;
    verified?: boolean;
};
export declare function validateEdits(input: unknown): SlideEdit[];
/**
 * -Edits: JSON list of edits. -Out: JSON results. Every target is resolved first; one that is not
 * found fails the whole run before anything changes. With -DryRun nothing is changed at all
 * (cloud files AutoSave, so "change and do not save" is not safe).
 */
export declare const OFFICE_EDIT_PS1: string;
export type ServerStatus = {
    status: 'verified';
    version: string;
    modified: string;
}
/** The server did not hold every change before the timeout (upload still running, or lost). */
 | {
    status: 'pending';
    version?: string;
    modified?: string;
    waitedSeconds: number;
}
/** No SharePoint session to check with (`jirallm sharepoint:auth`). */
 | {
    status: 'unchecked';
    message: string;
};
export type EditReport = {
    /** The deck was already open in the user's PowerPoint; the edit went into that window. */
    wasOpen: boolean;
    /** The document's own URL on SharePoint (not the sharing link). */
    fullName: string;
    results: EditResult[];
    /** Absent on a dry run. */
    server?: ServerStatus;
};
export type EditOptions = {
    dryRun?: boolean;
    timeoutMs?: number;
    /** How long to wait for SharePoint to hold the changes (default 120 s). */
    verifyTimeoutMs?: number;
    /** For tests: the client for the server check (null = no session), the PowerShell runner, the sleep. */
    client?: SharePointClient | null;
    run?: (args: string[]) => Promise<void>;
    sleep?: (ms: number) => Promise<void>;
};
/**
 * Applies the edits in a visible PowerPoint window and saves; the deck stays open so PowerPoint can
 * finish uploading. Then checks SharePoint itself (not Office's cache): it waits until the server's
 * copy holds every changed line (and, for find edits, no longer the old text). With `dryRun`, only checks the targets.
 */
export declare function editPowerPoint(url: string, edits: SlideEdit[], opts?: EditOptions): Promise<EditReport>;
export declare function parseEditReport(raw: Raw): EditReport;
/** A change that did not (yet) reach SharePoint is a failure for the CLI's exit code. */
export declare function editNeedsAttention(report: EditReport): boolean;
export declare function describeEditResults(report: EditReport, dryRun?: boolean): string;
//# sourceMappingURL=sharepointOfficeEdit.d.ts.map