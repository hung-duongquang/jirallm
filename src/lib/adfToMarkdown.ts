export type JiraADFContent = {
  type: string;
  content?: JiraADFContent[];
  text?: string;
  marks?: Array<{
    type: string;
    attrs?: { href?: string; [key: string]: unknown };
  }>;
  attrs?: {
    id?: string;
    type?: string;
    collection?: string;
    url?: string;
    alt?: string;
    language?: string;
    level?: number;
    state?: string;
    title?: string;
    colspan?: number;
    text?: string;
    shortName?: string;
    timestamp?: string | number;
  };
};

export type JiraADFDocument = {
  version: number;
  type: string;
  content: JiraADFContent[];
};

const BLOCK_CONTAINERS = new Set([
  'panel',
  'expand',
  'nestedExpand',
  'layoutSection',
  'layoutColumn',
]);

type JiraADFMark = NonNullable<JiraADFContent['marks']>[number];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const hasStringType = (value: unknown) => isRecord(value) && typeof value.type === 'string';

const isAdfNode = (value: unknown): value is JiraADFContent => hasStringType(value);

const isAdfMark = (value: unknown): value is JiraADFMark => hasStringType(value);

const childNodesOf = (node: { content?: unknown }) =>
  Array.isArray(node.content) ? node.content.filter(isAdfNode) : undefined;

/**
 * Converts a Jira ADF document to Markdown.
 *
 * When `attachments` is empty (the default), media and attachment references cannot be
 * resolved to filenames and degrade accordingly; everything else renders identically.
 *
 * Malformed input never throws: nodes that are not objects carrying a string `type`, and
 * `content` values that are not arrays, are skipped and traversal continues with siblings.
 */
export function convertADFToMarkdown(
  content: string | JiraADFDocument | null | undefined,
  attachments: Array<{ id: string; filename: string; url?: string }> = []
): string {
  if (!content) return '';
  if (typeof content === 'string') return content;

  const topLevelNodes = childNodesOf(content) ?? [];

  const filenameSet = new Set(attachments.map((att) => att.filename));
  const altMatchedFilenames = new Set<string>();
  const collectAltMatches = (node: JiraADFContent) => {
    if ((node.type === 'media' || node.type === 'mediaInline') && node.attrs?.alt) {
      if (filenameSet.has(node.attrs.alt)) altMatchedFilenames.add(node.attrs.alt);
    }
    childNodesOf(node)?.forEach(collectAltMatches);
  };
  topLevelNodes.forEach(collectAltMatches);
  const unmatchedAttachments = attachments.filter(
    (att) => !altMatchedFilenames.has(att.filename)
  );

  const formatMediaLink = (filename: string) => {
    const isImage = /\.(png|jpg|jpeg|gif|svg|webp|bmp|ico)$/i.test(filename);
    return isImage
      ? `![image](attachments/${filename})`
      : `[${filename}](attachments/${filename})`;
  };

  const applyMarks = (rawText: string, marks?: JiraADFContent['marks']) => {
    if (!Array.isArray(marks)) return rawText;
    // Markdown emphasis must hug its text (`** x **` is not bold), so surrounding
    // whitespace is moved outside the markers; whitespace-only text stays unmarked.
    const [, leading, core, trailing] = /^(\s*)([\s\S]*?)(\s*)$/.exec(rawText)!;
    if (core === '') return rawText;
    let text = core;
    for (const mark of marks.filter(isAdfMark)) {
      switch (mark.type) {
        case 'code':
          text = `\`${text}\``;
          break;
        case 'strong':
          text = `**${text}**`;
          break;
        case 'em':
          text = `*${text}*`;
          break;
        case 'strike':
          text = `~~${text}~~`;
          break;
        case 'link':
          if (mark.attrs?.href) text = `[${text}](${mark.attrs.href})`;
          break;
      }
    }
    return leading + text + trailing;
  };

  const extractText = (node: unknown, isTopLevel = false, listIndex?: number): string => {
    if (!isAdfNode(node)) return '';
    const children = childNodesOf(node);

    if ((node.type === 'media' || node.type === 'mediaInline') && node.attrs) {
      const filename = node.attrs.alt;
      if (filename && filenameSet.has(filename)) return formatMediaLink(filename);
      if (unmatchedAttachments.length > 0) {
        const att = unmatchedAttachments.shift()!;
        return formatMediaLink(att.filename);
      }
      if (filename) return formatMediaLink(filename);
      const mediaId = node.attrs.id;
      return mediaId ? `![embedded media](media/${mediaId})` : '![embedded media]()';
    }

    if (node.type === 'mediaSingle' && children) {
      return children.map((child) => extractText(child)).join('');
    }

    if (node.type === 'mediaGroup' && children) {
      return children.map((child) => extractText(child)).join('\n');
    }

    if ((node.type === 'inlineCard' || node.type === 'blockCard') && node.attrs?.url) {
      const matched = attachments.find((att) => att.url && node.attrs!.url!.includes(att.id));
      if (matched) return `[${matched.filename}](attachments/${matched.filename})`;
      return node.attrs.url;
    }

    // Two trailing spaces make a Markdown hard line break; a bare newline would be joined
    // into the same line when rendered.
    if (node.type === 'hardBreak') return '  \n';
    if (node.type === 'rule') return '---';

    if (node.text) return applyMarks(node.text, node.marks);

    // Inline atoms carry their content in attrs; dropping them can invert a table's meaning
    // (e.g. a ✅ permission matrix rendering as all-empty cells).
    if (node.type === 'emoji') return node.attrs?.text || node.attrs?.shortName || '';
    if (node.type === 'mention') {
      const name = node.attrs?.text ?? '';
      return name && !name.startsWith('@') ? `@${name}` : name;
    }
    if (node.type === 'status') return node.attrs?.text ? `**[${node.attrs.text}]**` : '';
    if (node.type === 'date') {
      const ms = Number(node.attrs?.timestamp ?? NaN);
      return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : '';
    }

    if (node.type === 'heading' && children) {
      const level = node.attrs?.level ?? 1;
      const childContent = children.map((child) => extractText(child)).join('');
      return '#'.repeat(level) + ' ' + childContent;
    }

    if (node.type === 'codeBlock') {
      const lang = node.attrs?.language ?? '';
      const childContent = children?.map((child) => extractText(child)).join('') ?? '';
      return '```' + lang + '\n' + childContent + '\n```';
    }

    if (node.type === 'blockquote' && children) {
      const childContent = children.map((child) => extractText(child)).join('\n');
      return childContent
        .split('\n')
        .map((line) => '> ' + line)
        .join('\n');
    }

    // A top-level list ends with a blank line: otherwise a following paragraph is a lazy
    // continuation of the last item and renders inside it.
    if (node.type === 'bulletList' && children) {
      const list = children
        .map((child) => extractText(child, false, -1))
        .filter(Boolean)
        .join('\n');
      return isTopLevel && list ? list + '\n' : list;
    }

    if (node.type === 'orderedList' && children) {
      const list = children
        .map((child, i) => extractText(child, false, i + 1))
        .filter(Boolean)
        .join('\n');
      return isTopLevel && list ? list + '\n' : list;
    }

    if (node.type === 'listItem' && children) {
      const prefix = listIndex !== undefined && listIndex > 0 ? `${listIndex}. ` : '- ';
      const childContent = children.map((child) => extractText(child)).join('\n');
      // Empty items (e.g. a stray "3." left in the Jira editor) carry no content.
      if (childContent.trim() === '') return '';
      // Continuation lines (nested lists, hard breaks) are indented under the item's
      // text, otherwise a nested list renders as siblings of its parent.
      const indent = ' '.repeat(prefix.length);
      return prefix + childContent.replace(/\n$/, '').replace(/\n(?=.)/g, '\n' + indent);
    }

    // Block containers render their children like top-level blocks so paragraphs, lists
    // and tables inside them keep their line breaks instead of being glued together.
    if (BLOCK_CONTAINERS.has(node.type) && children) {
      const title = node.attrs?.title ? `**${node.attrs.title}**\n` : '';
      return title + children.map((child) => extractText(child, true)).join('\n');
    }

    if (node.type === 'taskList' && children) {
      return children.map((child) => extractText(child)).join('\n');
    }

    if (node.type === 'taskItem') {
      const checked = node.attrs?.state === 'DONE' ? 'x' : ' ';
      const childContent = children?.map((child) => extractText(child)).join('') ?? '';
      return `- [${checked}] ${childContent}`;
    }

    if (node.type === 'table' && children) {
      const rows = children.filter((child) => child.type === 'tableRow');
      if (rows.length === 0) return '';

      // Headings are not valid inside a Markdown table cell, so they render as bold text.
      // Task checkboxes (`- [ ]`) only render in lists, so a cell uses ☐ / ☑ instead.
      const renderCellBlock = (child: JiraADFContent) => {
        if (child.type === 'taskList') {
          return (childNodesOf(child) ?? [])
            .map((item) => {
              const box = item.attrs?.state === 'DONE' ? '☑' : '☐';
              const content = (childNodesOf(item) ?? []).map((c) => extractText(c)).join('');
              return `${box} ${content}`;
            })
            .join('\n');
        }
        if (child.type !== 'heading') return extractText(child);
        const heading = (childNodesOf(child) ?? []).map((c) => extractText(c)).join('');
        return /^\*\*.*\*\*$/.test(heading) ? heading : applyMarks(heading, [{ type: 'strong' }]);
      };

      // A Markdown table row must stay on one line: block children (paragraphs, list
      // items, hard breaks) are separated by <br/>, and pipes are escaped. Indentation of
      // nested list items is kept as non-breaking spaces, which survive inside a cell.
      const renderCell = (cell: JiraADFContent) =>
        (childNodesOf(cell) ?? [])
          .map((child) => renderCellBlock(child).trim())
          .filter(Boolean)
          .join('\n')
          .replace(/\|/g, '\\|')
          .replace(
            /[ \t]*\n(?:[ \t]*\n)*( *)/g,
            (_, indent: string) => '<br/>' + '&nbsp;'.repeat(indent.length)
          );

      // Markdown has no merged cells: a cell spanning N columns is followed by N-1 empty
      // cells so every row keeps the table's column count.
      const spanOf = (cell: JiraADFContent) => {
        const colspan = Number(cell.attrs?.colspan);
        return Number.isInteger(colspan) && colspan > 1 ? colspan : 1;
      };

      const processRow = (row: JiraADFContent) => {
        const cells =
          childNodesOf(row)?.flatMap((cell) => [
            renderCell(cell),
            ...Array<string>(spanOf(cell) - 1).fill(''),
          ]) ?? [];
        return '| ' + cells.join(' | ') + ' |';
      };

      const headerRow = processRow(rows[0]);
      const colCount = (childNodesOf(rows[0]) ?? []).reduce((sum, cell) => sum + spanOf(cell), 0);
      const separator = '| ' + Array(colCount).fill('---').join(' | ') + ' |';
      const bodyRows = rows.slice(1).map(processRow);

      // A table must be followed by a blank line: in GFM, a text line directly after a
      // table is parsed as one more row.
      const table = [headerRow, separator, ...bodyRows].join('\n');
      return isTopLevel ? table + '\n' : table;
    }

    if (node.type === 'tableRow' || node.type === 'tableCell' || node.type === 'tableHeader') {
      return children?.map((child) => extractText(child)).join('') ?? '';
    }

    if (children) {
      const childContent = children.map((child) => extractText(child)).join('');
      if (isTopLevel && node.type === 'paragraph') return childContent + '\n';
      return childContent;
    }

    return '';
  };

  return topLevelNodes.map((node) => extractText(node, true)).join('\n');
}
