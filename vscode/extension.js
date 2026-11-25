// VS Code side of `jirallm ui`'s Resume button: vscode://jirallm.jirallm-sessions/resume?id=<session>&cwd=<dir>&title=<t>
// opens a terminal in this window running `jirallm resume <session>` (which starts `claude --resume`
// unless the session already runs). Only a session id is taken from the link, never a command.
// /handle?tag=<slack export folder>&cwd=<dir> (a Slack message that tags the user: the toast's and
// the UI's "Handle in Claude") runs `jirallm slack:handle <folder>`, which starts a new Claude session on it.
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
/** A Slack export folder: <channel id>-<thread ts without the dot>. */
const SLACK_DIR = /^[a-z0-9]{1,20}-\d{16}$/;
/** A Jira key: /handle?ticket=<KEY> runs `jirallm ticket:handle <KEY>` (the "Assigned to you" toast's "Start in Claude"). */
const TICKET_KEY = /^[A-Z][A-Z0-9]{0,9}-\d{1,7}$/;

/**
 * The icon Claude Code's own extension gives its terminals (its claude-logo.svg), so a resumed session
 * looks like any other Claude terminal; the plain terminal icon when that extension is not installed.
 */
function claudeIcon() {
  const ext = vscode.extensions.getExtension('anthropic.claude-code');
  const logo = ext && path.join(ext.extensionPath, 'resources', 'claude-logo.svg');
  return logo && fs.existsSync(logo) ? vscode.Uri.file(logo) : new vscode.ThemeIcon('terminal');
}

/** A Claude-looking terminal in `cwd` running one jirallm command. */
function run(cwd, command) {
  // No name: a named terminal's tab keeps that name, while an unnamed one shows the title Claude
  // keeps setting (its session title with a spinner while it works, ✳ while it waits), like a
  // terminal where `claude` was typed by hand.
  const terminal = vscode.window.createTerminal({
    cwd: cwd && fs.existsSync(cwd) ? cwd : undefined,
    iconPath: claudeIcon(),
  });
  terminal.show();
  terminal.sendText(command);
}

exports.activate = (context) => {
  log(`activated in ${vscode.workspace.name ?? '(no folder)'}`);
  context.subscriptions.push(
    vscode.window.registerUriHandler({
      handleUri(uri) {
        log(`link ${uri.path}?${uri.query}`);
        const q = new URLSearchParams(uri.query);
        const cwd = q.get('cwd') ?? '';
        if (uri.path === '/handle' && q.has('ticket')) {
          const key = q.get('ticket') ?? '';
          if (!TICKET_KEY.test(key)) {
            vscode.window.showErrorMessage(`jirallm: not a Jira key: ${key}`);
            return;
          }
          run(cwd, `jirallm ticket:handle ${key}`);
          return;
        }
        if (uri.path === '/handle') {
          const tag = q.get('tag') ?? '';
          if (!SLACK_DIR.test(tag)) {
            vscode.window.showErrorMessage(`jirallm: not a Slack thread folder: ${tag}`);
            return;
          }
          run(cwd, `jirallm slack:handle ${tag}`);
          return;
        }
        if (uri.path !== '/resume') return;
        const id = q.get('id') ?? '';
        if (!SESSION_ID.test(id)) {
          vscode.window.showErrorMessage(`jirallm: not a Claude session id: ${id}`);
          return;
        }
        run(cwd, `jirallm resume ${id}`);
      },
    })
  );
};

exports.deactivate = () => {};
