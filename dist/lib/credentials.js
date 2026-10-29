const SERVICE = 'jirallm';
let keyringLoadPromise;
let cachedKeyring;
async function loadKeyring() {
    if (keyringLoadPromise)
        return keyringLoadPromise;
    keyringLoadPromise = (async () => {
        try {
            const mod = (await import('@napi-rs/keyring'));
            const resolved = mod.Entry ? mod : mod.default;
            cachedKeyring = resolved && resolved.Entry ? resolved : undefined;
        }
        catch {
            cachedKeyring = undefined;
        }
        return cachedKeyring;
    })();
    return keyringLoadPromise;
}
function entryFor(keyring, orgName) {
    return new keyring.Entry(SERVICE, `${orgName}:api_token`);
}
function envTokenFor(orgName) {
    const orgSpecific = process.env[`JIRALLM_API_TOKEN_${orgName.toUpperCase()}`];
    if (orgSpecific)
        return orgSpecific;
    return process.env.JIRALLM_API_TOKEN || undefined;
}
export async function getToken(orgName) {
    const keyring = await loadKeyring();
    const fromKeyring = await readKeyringToken(keyring, orgName);
    if (fromKeyring !== undefined)
        return fromKeyring;
    return envTokenFor(orgName);
}
export async function getTokenSource(orgName) {
    const keyring = await loadKeyring();
    const fromKeyring = await readKeyringToken(keyring, orgName);
    if (fromKeyring !== undefined)
        return 'keychain';
    if (envTokenFor(orgName) !== undefined)
        return 'env';
    return null;
}
async function readKeyringToken(keyring, orgName) {
    if (!keyring)
        return undefined;
    try {
        return entryFor(keyring, orgName).getPassword() || undefined;
    }
    catch {
        // NoEntry / Ambiguous → treat as missing
        return undefined;
    }
}
export async function setToken(orgName, token) {
    const keyring = await loadKeyring();
    if (!keyring) {
        throw new Error('OS keychain (@napi-rs/keyring) is unavailable. Reinstall jirallm or check that your platform binary is supported.');
    }
    entryFor(keyring, orgName).setPassword(token);
}
export async function removeToken(orgName) {
    const keyring = await loadKeyring();
    if (!keyring)
        return false;
    try {
        return entryFor(keyring, orgName).deletePassword();
    }
    catch {
        return false;
    }
}
export async function hasStoredToken(orgName) {
    const token = await getToken(orgName);
    return Boolean(token);
}
export const __test = {
    resetKeytarCache: () => {
        keyringLoadPromise = undefined;
        cachedKeyring = undefined;
    },
};
//# sourceMappingURL=credentials.js.map