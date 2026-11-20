type Severity = 'pass' | 'fail' | 'warn';
export type CheckResult = {
    name: string;
    severity: Severity;
    detail: string;
    hint?: string;
};
/**
 * Whether the Claude Code plugin works where the user runs Claude: installed, its session hooks ran (the
 * newest session's handshake, with the app it runs in), and a monitor served that session. Claude
 * Desktop's plain chat runs no plugins; its Code tab may, which this shows on the user's own machine.
 */
export declare function checkClaudePlugin(home?: string, sessionsDir?: string, now?: number): CheckResult;
/** All checks, without printing (`jirallm feedback` attaches them). */
export declare function doctorResults(opts?: {
    org?: string;
    project?: string;
}): Promise<CheckResult[]>;
export declare function runDoctor(opts?: {
    org?: string;
    project?: string;
    strict?: boolean;
    json?: boolean;
}): Promise<void>;
export {};
//# sourceMappingURL=doctor.d.ts.map