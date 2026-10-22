export function shouldOutputJson(flags) {
    return Boolean(flags.json) || !process.stdout.isTTY;
}
export function printJson(value) {
    process.stdout.write(JSON.stringify(value, null, 2) + '\n');
}
//# sourceMappingURL=jsonOutput.js.map