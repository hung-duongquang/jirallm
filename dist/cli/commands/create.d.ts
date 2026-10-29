export type CreateOptions = {
    org?: string;
    projectKey?: string;
    type: string;
    summary: string;
    description?: string;
    descriptionFile?: string;
    noWiki?: boolean;
    assignee?: string;
    labels?: string;
    priority?: string;
    parent?: string;
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
export declare function runCreate(opts: CreateOptions): Promise<void>;
//# sourceMappingURL=create.d.ts.map