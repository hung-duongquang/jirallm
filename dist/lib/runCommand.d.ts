export declare function runInteractive(command: string): Promise<number>;
type RunCommandOptions = {
    shouldThrow?: boolean;
    silent?: boolean;
};
export declare function runCommand(command: string, description: string, options?: RunCommandOptions): Promise<string>;
export {};
//# sourceMappingURL=runCommand.d.ts.map