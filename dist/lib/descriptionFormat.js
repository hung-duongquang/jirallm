export const DESCRIPTION_FORMATS = ['markdown', 'adf', 'both'];
export const DEFAULT_DESCRIPTION_FORMAT = 'markdown';
export function parseDescriptionFormat(value) {
    if (value === undefined)
        return DEFAULT_DESCRIPTION_FORMAT;
    const match = DESCRIPTION_FORMATS.find((format) => format === value);
    if (!match) {
        throw new Error(`Invalid --description-format "${value}". Allowed values: ${DESCRIPTION_FORMATS.join(', ')}.`);
    }
    return match;
}
//# sourceMappingURL=descriptionFormat.js.map