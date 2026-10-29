export type EditOptions = {
    issueKey: string;
    org?: string;
    summary?: string;
    description?: string;
    descriptionFile?: string;
    noWiki?: boolean;
    assignee?: string;
    unassign?: boolean;
    labels?: string;
    priority?: string;
    parent?: string;
    due?: string;
    components?: string[];
    field?: string[];
    sprint?: string;
    board?: string;
    attach?: string[];
    attachImages?: string[];
    attachMedia?: string[];
    imageLayout?: string;
    imageWidth?: string;
    dryRun?: boolean;
    json?: boolean;
};
export declare function runEdit(opts: EditOptions): Promise<void>;
//# sourceMappingURL=edit.d.ts.map