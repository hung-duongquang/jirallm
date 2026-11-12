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
          iconPath: new vscode.ThemeIcon('debug-restart'),
        });
        terminal.show();
        terminal.sendText(`jirallm resume ${id}`);
      },
    })
  );
};

exports.deactivate = () => {};
