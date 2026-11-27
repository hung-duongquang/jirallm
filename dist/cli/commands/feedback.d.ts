import { type CheckResult } from './doctor.js';
export declare const FEEDBACK_REPO = "hung-duongquang/jirallm-feedback";
export type FeedbackOptions = {
    session?: string;
    print?: boolean;
};
export type FeedbackFacts = {
    cli: string;
    plugin: string;
    app: string;
    os: string;
    node: string;
    session?: string;
    follows: string[];
    deliveries: Array<{
        n: number;
        at: string;
        via: string;
        items: string[];
    }>;
    doctor: CheckResult[];
};
/** The issue: title from the first line of the text, body with the facts. */
export declare function feedbackIssue(text: string, f: FeedbackFacts): {
    title: string;
    body: string;
};
export declare function runFeedback(words: string[], opts?: FeedbackOptions): Promise<void>;
//# sourceMappingURL=feedback.d.ts.map