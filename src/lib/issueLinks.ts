import { existsSync, readdirSync } from 'fs';
import { join } from 'path';

const BROWSE_URL = /^https?:\/\/[^/\s]+\/browse\/([A-Z][A-Z0-9]+-\d+)\/?(?:[?#][^\s)]*)?$/i;

/** `ZOD-3568` for `https://acme.atlassian.net/browse/ZOD-3568` (query/fragment allowed). */
export function jiraIssueKeyFromUrl(url: string): string | undefined {
  return BROWSE_URL.exec(url.trim())?.[1]?.toUpperCase();
}

export type LocalIssueLinkOptions = {
  /** Folder the issue bundles are exported to; task.md files live one level below it. */
  outputDir: string;
  /** The issue being written; links to itself stay pointed at Jira. */
  selfKey?: string;
  /** Issues exported in the same run, which may not be on disk yet. */
  batchKeys?: string[];
};

/**
 * Points Markdown links to Jira issues (`[text](https://…/browse/KEY)`) at a local copy when
 * the output folder has one: an exported bundle (`<key>/task.md`) or a loose `KEY….md` file.
 * Links are rewritten relative to the issue's own folder (`<outputDir>/<key>/task.md`).
 * Issues without a local copy keep their Jira link.
 */
export function linkLocalIssues(markdown: string, options: LocalIssueLinkOptions): string {
  const self = options.selfKey?.toUpperCase();
  const batch = new Set((options.batchKeys ?? []).map((k) => k.toUpperCase()));
  let looseFiles: string[] | undefined;
  const cache = new Map<string, string | undefined>();

  const resolveLocal = (key: string): string | undefined => {
    if (cache.has(key)) return cache.get(key);
    const dirName = key.toLowerCase();
    let target: string | undefined;
    if (batch.has(key) || existsSync(join(options.outputDir, dirName, 'task.md'))) {
      target = `../${dirName}/task.md`;
    } else {
      looseFiles ??= existsSync(options.outputDir)
        ? readdirSync(options.outputDir).filter((name) => name.toLowerCase().endsWith('.md'))
        : [];
      // `ZOD-35` must not match `ZOD-3568-….md`; prefer the shortest name (the ticket itself
      // over e.g. a "-test-result" companion file).
      const keyPrefix = new RegExp(`^${key}(?![0-9])`, 'i');
      const match = looseFiles
        .filter((name) => keyPrefix.test(name))
        .sort((a, b) => a.length - b.length)[0];
      if (match) target = `../${match.replace(/ /g, '%20')}`;
    }
    cache.set(key, target);
    return target;
  };

  return markdown.replace(
    /\[([^\]\n]*)\]\((https?:\/\/[^)\s]+)\)/g,
    (link, text: string, url: string) => {
      const key = jiraIssueKeyFromUrl(url);
      if (!key || key === self) return link;
      const local = resolveLocal(key);
      return local ? `[${text}](${local})` : link;
    }
  );
}
