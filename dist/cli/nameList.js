export function normalizeNameList(values) {
    if (values === undefined)
        return undefined;
    const names = values.map((value) => value.trim()).filter(Boolean);
    return [...new Set(names)];
}
//# sourceMappingURL=nameList.js.map