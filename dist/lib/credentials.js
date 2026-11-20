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
/**
 * Windows Credential Manager holds at most 2560 bytes per entry (1280 UTF-16 chars), less than a
 * SharePoint FedAuth cookie. Longer secrets are split: the main entry holds a `chunks:<n>` marker
 * and `<account>#1`…`#n` hold the parts.
 */
const SECRET_CHUNK = 1000;
const CHUNK_MARKER = /^jirallm-chunks:(\d+)$/;
function readEntry(keyring, account) {
    try {
        return new keyring.Entry(SERVICE, account).getPassword();
    }
    catch {
        return null; // NoEntry
    }
}
function deleteEntry(keyring, account) {
    try {
        return new keyring.Entry(SERVICE, account).deletePassword();
    }
    catch {
        return false;
    }
}
/** Removes the `#n` parts of a chunked secret (no-op for a plain one). */
function deleteChunks(keyring, account) {
    const marker = CHUNK_MARKER.exec(readEntry(keyring, account) ?? '');
    if (!marker)
        return;
    for (let i = 1; i <= Number(marker[1]); i++)
        deleteEntry(keyring, `${account}#${i}`);
}
/** Reads a non-Jira secret (e.g. `slack:token`) from the keychain, else from `envVar`. */
export async function getSecret(account, envVar) {
    const keyring = await loadKeyring();
    if (keyring) {
        const value = readEntry(keyring, account);
        const marker = CHUNK_MARKER.exec(value ?? '');
        if (marker) {
            const parts = [];
            for (let i = 1; i <= Number(marker[1]); i++)
                parts.push(readEntry(keyring, `${account}#${i}`) ?? '');
            if (parts.every(Boolean))
                return parts.join('');
        }
        else if (value) {
            return value;
        }
    }
    return process.env[envVar] || undefined;
}
export async function setSecret(account, value) {
    const keyring = await loadKeyring();
    if (!keyring)
        throw new Error('OS keychain (@napi-rs/keyring) is unavailable.');
    deleteChunks(keyring, account);
    if (value.length <= SECRET_CHUNK) {
        new keyring.Entry(SERVICE, account).setPassword(value);
        return;
    }
    const count = Math.ceil(value.length / SECRET_CHUNK);
    for (let i = 1; i <= count; i++) {
        new keyring.Entry(SERVICE, `${account}#${i}`).setPassword(value.slice((i - 1) * SECRET_CHUNK, i * SECRET_CHUNK));
    }
    new keyring.Entry(SERVICE, account).setPassword(`jirallm-chunks:${count}`);
}
export async function removeSecret(account) {
    const keyring = await loadKeyring();
    if (!keyring)
        return false;
    deleteChunks(keyring, account);
    return deleteEntry(keyring, account);
}
//# sourceMappingURL=credentials.js.map