// `jirallm mcp --install / --uninstall`: adds jirallm to Claude Desktop's MCP servers
// (claude_desktop_config.json, "mcpServers"), so its Chat tab gets the jirallm tools and approval cards.
import { copyFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const SERVER_NAME = 'jirallm';
const CONFIG = 'claude_desktop_config.json';
/**
 * Claude Desktop config files of this account: the classic install (%APPDATA%\Claude, macOS Application
 * Support) and the packaged Windows app (%LOCALAPPDATA%\Claude-Data\claude_<id>). Only folders that exist:
 * Desktop creates them on its first start.
 */
export function desktopConfigPaths(env = process.env, home = os.homedir()) {
    const dirs = [];
    if (process.platform === 'darwin')
        dirs.push(path.join(home, 'Library', 'Application Support', 'Claude'));
    if (env.APPDATA)
        dirs.push(path.join(env.APPDATA, 'Claude'));
    if (env.LOCALAPPDATA) {
        const data = path.join(env.LOCALAPPDATA, 'Claude-Data');
        try {
            for (const d of readdirSync(data))
                if (/^claude_/i.test(d))
                    dirs.push(path.join(data, d));
        }
        catch {
            // No packaged install.
        }
    }
    if (process.platform === 'linux')
        dirs.push(path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'Claude'));
    return dirs.filter((d) => existsSync(d)).map((d) => path.join(d, CONFIG));
}
/** How Desktop starts the server: this Node and this install's CLI (no shell, so no .cmd shim needed). */
export function serverEntry() {
    const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'cli', 'index.js');
    return { command: process.execPath, args: [cli, 'mcp'] };
}
/** Adds (or with `remove`, drops) the jirallm server in each config, keeping everything else; backs up first. */
export function updateDesktopConfigs(files, entry) {
    return files.map((file) => {
        let config = {};
        if (existsSync(file)) {
            const raw = readFileSync(file, 'utf8');
            config = raw.trim() ? JSON.parse(raw) : {};
        }
        const servers = { ...(config.mcpServers ?? {}) };
        const before = JSON.stringify(servers[SERVER_NAME] ?? null);
        let action;
        if (entry) {
            action = servers[SERVER_NAME] === undefined ? 'added' : before === JSON.stringify(entry) ? 'unchanged' : 'updated';
            servers[SERVER_NAME] = entry;
        }
        else {
            action = servers[SERVER_NAME] === undefined ? 'absent' : 'removed';
            delete servers[SERVER_NAME];
        }
        if (action === 'unchanged' || action === 'absent')
            return { file, action };
        if (existsSync(file))
            copyFileSync(file, `${file}.jirallm.bak`);
        writeFileSync(file, `${JSON.stringify({ ...config, mcpServers: servers }, null, 2)}\n`, 'utf8');
        return { file, action };
    });
}
export function runMcpInstall(opts) {
    const files = desktopConfigPaths();
    const entry = serverEntry();
    if (!files.length) {
        console.log('Claude Desktop was not found for this account (start it once, then run this again).');
    }
    else {
        for (const c of updateDesktopConfigs(files, opts.uninstall ? undefined : entry))
            console.log(`${c.action.padEnd(9)} ${c.file}`);
        console.log(opts.uninstall
            ? 'Restart Claude Desktop (quit it from the tray icon) to drop the jirallm tools.'
            : 'Restart Claude Desktop (quit it from the tray icon, then start it): the Chat tab then has the jirallm tools. Jira changes show an approval card.');
    }
    if (!opts.uninstall) {
        const quoted = [entry.command, ...entry.args].map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ');
        console.log(`\nOther MCP clients: run ${quoted}\nClaude Code (outside the plugin): claude mcp add ${SERVER_NAME} -- ${quoted}`);
    }
}
//# sourceMappingURL=install.js.map