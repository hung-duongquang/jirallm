export const INSECURE_HTTP_ENV = 'JIRALLM_ALLOW_INSECURE_HTTP';
const LOOPBACK_HOSTNAMES = ['localhost', '127.0.0.1', '[::1]'];
export function isInsecureHttpAllowed(env = process.env) {
    return env[INSECURE_HTTP_ENV] === '1';
}
function parseUrl(raw) {
    try {
        return new URL(raw);
    }
    catch {
        return undefined;
    }
}
function insecureHttpPermitted(url, options) {
    if (LOOPBACK_HOSTNAMES.includes(url.hostname))
        return true;
    return options.allowInsecureHttp ?? isInsecureHttpAllowed();
}
export function baseUrlProblem(raw, options = {}) {
    const url = parseUrl(raw);
    if (!url)
        return 'is not a valid URL';
    if (url.protocol !== 'https:' && url.protocol !== 'http:')
        return 'must use https://';
    if (url.username || url.password)
        return 'must not contain credentials';
    if (url.search || url.hash)
        return 'must not contain a query string or fragment';
    if (url.protocol === 'http:' && !insecureHttpPermitted(url, options)) {
        return `must use https:// — plain http sends the API token unencrypted (set ${INSECURE_HTTP_ENV}=1 to allow it)`;
    }
    return undefined;
}
export function assertSecureBaseUrl(raw, options = {}) {
    const problem = baseUrlProblem(raw, options);
    if (problem)
        throw new Error(`Invalid Jira base URL "${raw}": ${problem}.`);
}
export function isSameOrigin(candidate, baseUrl) {
    const candidateUrl = parseUrl(candidate);
    const base = parseUrl(baseUrl);
    if (!candidateUrl || !base)
        return false;
    return candidateUrl.origin === base.origin;
}
//# sourceMappingURL=baseUrl.js.map