function errorMessage(err) {
    if (err instanceof Error)
        return err.message;
    return String(err);
}
export function formatError(err, { json, debug }) {
    if (json)
        return JSON.stringify({ error: errorMessage(err) });
    if (debug && err instanceof Error && err.stack)
        return err.stack;
    return errorMessage(err);
}
export function reportError(err) {
    console.error(formatError(err, {
        json: process.argv.includes('--json'),
        debug: Boolean(process.env.DEBUG),
    }));
}
export function exitOnError(err) {
    reportError(err);
    process.exit(1);
}
//# sourceMappingURL=errors.js.map