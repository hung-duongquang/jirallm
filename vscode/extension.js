// VS Code side of `jirallm ui`'s Resume button: vscode://jirallm.jirallm-sessions/resume?id=<session>&cwd=<dir>&title=<t>
// opens a terminal in this window running `jirallm resume <session>` (which starts `claude --resume`
// unless the session already runs). Only a session id is taken from the link, never a command.
const vscode = require('vscode');
const fs = require('fs');
const os = require('os');
const path = require('path');

/** Activation and each link, in the sessions dir, so `jirallm ui` problems can be traced. */
function log(line) {
  try {
    const dir = path.join(os.tmpdir(), 'jirallm-sessions');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'vscode-extension.log'), `${new Date().toISOString()} ${line}\n`);
  } catch {
    // Logging is a bonus.
  }
}

const SESSION_ID = /^[\w-]{1,100}$/;

/**
 * The icon Claude Code's own extension gives its terminals (its claude-logo.svg), so a resumed session
 * looks like any other Claude terminal; the plain terminal icon when that extension is not installed.
 */
function claudeIcon() {
  const ext = vscode.extensions.getExtension('anthropic.claude-code');
  const logo = ext && path.join(ext.extensionPath, 'resources', 'claude-logo.svg');
  return logo && fs.existsSync(logo) ? vscode.Uri.file(logo) : new vscode.ThemeIcon('terminal');
}

exports.activate = (context) => {
  log(`activated in ${vscode.workspace.name ?? '(no folder)'}`);
  context.subscriptions.push(
    vscode.window.registerUriHandler({
      handleUri(uri) {
        log(`link ${uri.path}?${uri.query}`);
        if (uri.path !== '/resume') return;
        const q = new URLSearchParams(uri.query);
        const id = q.get('id') ?? '';
        if (!SESSION_ID.test(id)) {
          vscode.window.showErrorMessage(`jirallm: not a Claude session id: ${id}`);
          return;
        }
        const cwd = q.get('cwd') ?? '';
        const title = (q.get('title') || id.slice(0, 8)).replace(/[\r\n]/g, ' ').slice(0, 40);
        const terminal = vscode.window.createTerminal({
          name: `claude: ${title}`,
          cwd: cwd && fs.existsSync(cwd) ? cwd : undefined,
          iconPath: claudeIcon(),
          // In the editor area, like the terminals Claude Code's extension opens: an editor tab shows the
          // title Claude keeps setting ("✳ …", a spinner while it works), where a panel tab keeps this name.
          location: { viewColumn: vscode.ViewColumn.Active },
        });
        terminal.show();
        terminal.sendText(`jirallm resume ${id}`);
      },
    })
  );
};

exports.deactivate = () => {};
