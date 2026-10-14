import { describe, expect, it } from 'vitest';
import { convertADFToMarkdown } from './adfToMarkdown.js';

function doc(...content: unknown[]): never {
  return { version: 1, type: 'doc', content } as never;
}

function paragraph(...content: unknown[]): unknown {
  return { type: 'paragraph', content };
}

function text(value: string, marks?: unknown[]): unknown {
  return marks ? { type: 'text', text: value, marks } : { type: 'text', text: value };
}

describe('convertADFToMarkdown malformed nodes', () => {
  it('skips null and undefined children without throwing', () => {
    expect(convertADFToMarkdown(doc(null))).toBe('');
    expect(convertADFToMarkdown(doc(undefined))).toBe('');
  });

  it('renders valid nodes when malformed siblings are mixed in', () => {
    const out = convertADFToMarkdown(
      doc(paragraph(text('first')), null, paragraph(text('second')), undefined)
    );
    expect(out).toBe('first\n\nsecond\n');
  });

  it('skips non-object children', () => {
    expect(convertADFToMarkdown(doc('string', 42, true))).toBe('');
    expect(convertADFToMarkdown(doc('string', paragraph(text('kept')), 42))).toBe('kept\n');
  });

  it('skips nodes that carry no usable type', () => {
    expect(convertADFToMarkdown(doc({ content: [text('orphan')] }))).toBe('');
    expect(convertADFToMarkdown(doc({ type: 7, text: 'orphan' }))).toBe('');
  });

  it('treats a non-array content value as no content', () => {
    expect(convertADFToMarkdown(doc({ type: 'paragraph', content: 'oops' }))).toBe('');
    expect(convertADFToMarkdown(doc({ type: 'heading', attrs: { level: 2 }, content: 3 }))).toBe(
      ''
    );
  });

  it('returns an empty string when the document content is missing or not an array', () => {
    expect(convertADFToMarkdown({ version: 1, type: 'doc' } as never)).toBe('');
    expect(convertADFToMarkdown({ version: 1, type: 'doc', content: 'nope' } as never)).toBe('');
    expect(convertADFToMarkdown({ version: 1, type: 'doc', content: null } as never)).toBe('');
  });

  it('returns an empty string for a table with no table rows', () => {
    expect(convertADFToMarkdown(doc({ type: 'table', content: [] }))).toBe('');
    expect(convertADFToMarkdown(doc({ type: 'table', content: [null, 'junk'] }))).toBe('');
    expect(
      convertADFToMarkdown(doc({ type: 'table', content: [paragraph(text('stray'))] }))
    ).toBe('');
  });

  it('skips malformed cells and rows inside an otherwise valid table', () => {
    const cell = (value: string) => ({ type: 'tableCell', content: [paragraph(text(value))] });
    const out = convertADFToMarkdown(
      doc({
        type: 'table',
        content: [
          { type: 'tableRow', content: [cell('H1'), cell('H2')] },
          null,
          { type: 'tableRow', content: [cell('a'), null, cell('b')] },
          { type: 'tableRow', content: 'oops' },
        ],
      })
    );
    expect(out).toBe('| H1 | H2 |\n| --- | --- |\n| a | b |\n|  |\n');
  });

  it('skips a malformed node nested deep inside a list', () => {
    const out = convertADFToMarkdown(
      doc({
        type: 'bulletList',
        content: [
          { type: 'listItem', content: [paragraph(text('a')), null] },
          null,
          { type: 'listItem', content: [paragraph(text('b'))] },
        ],
      })
    );
    expect(out).toBe('- a\n- b');
  });

  it('skips malformed marks on a text node', () => {
    const out = convertADFToMarkdown(
      doc(paragraph(text('bold', [null, { type: 'strong' }, 'junk'])))
    );
    expect(out).toBe('**bold**\n');
  });

  it('still renders a well-formed document unchanged', () => {
    const cell = (value: string) => ({ type: 'tableCell', content: [paragraph(text(value))] });
    const out = convertADFToMarkdown(
      doc(
        { type: 'heading', attrs: { level: 2 }, content: [text('Title')] },
        paragraph(text('intro '), text('bold', [{ type: 'strong' }])),
        {
          type: 'bulletList',
          content: [
            { type: 'listItem', content: [paragraph(text('one'))] },
            { type: 'listItem', content: [paragraph(text('two'))] },
          ],
        },
        { type: 'codeBlock', attrs: { language: 'ts' }, content: [text('const a = 1;')] },
        {
          type: 'table',
          content: [
            { type: 'tableRow', content: [cell('H1'), cell('H2')] },
            { type: 'tableRow', content: [cell('a'), cell('b')] },
          ],
        }
      )
    );
    expect(out).toBe(
      [
        '## Title',
        'intro **bold**\n',
        '- one\n- two',
        '```ts\nconst a = 1;\n```',
        '| H1 | H2 |\n| --- | --- |\n| a | b |\n',
      ].join('\n')
    );
  });

  it('keeps positional attachment fallback stable when malformed nodes are present', () => {
    const attachments = [
      { id: '1', filename: 'first.png' },
      { id: '2', filename: 'second.png' },
    ];
    const out = convertADFToMarkdown(
      doc(
        paragraph({ type: 'media', attrs: {} }),
        null,
        paragraph({ type: 'media', attrs: {} })
      ),
      attachments
    );
    expect(out).toBe('![image](attachments/first.png)\n\n![image](attachments/second.png)\n');
  });
});

describe('convertADFToMarkdown table cells and containers', () => {
  const listItem = (...content: unknown[]) => ({ type: 'listItem', content });
  const table = (...rows: unknown[][]) => ({
    type: 'table',
    content: rows.map((cells) => ({
      type: 'tableRow',
      content: cells.map((content) => ({ type: 'tableCell', content })),
    })),
  });

  it('keeps a cell containing a list on a single row, joined with <br/>', () => {
    const out = convertADFToMarkdown(
      doc(
        table(
          [[paragraph(text('Name'))], [paragraph(text('Outcome'))]],
          [
            [paragraph(text('Check'))],
            [
              {
                type: 'orderedList',
                content: [
                  listItem(paragraph(text('Found → '), text('next', [{ type: 'em' }]))),
                  listItem(paragraph(text('None → stop.'))),
                ],
              },
            ],
          ]
        )
      )
    );
    expect(out).toBe(
      '| Name | Outcome |\n| --- | --- |\n| Check | 1. Found → *next*<br/>2. None → stop. |\n'
    );
  });

  it('joins multiple paragraphs and hard breaks in a cell with <br/> and escapes pipes', () => {
    const out = convertADFToMarkdown(
      doc(
        table(
          [[paragraph(text('H'))]],
          [[paragraph(text('a | b'), { type: 'hardBreak' }, text('c')), paragraph(text('d'))]]
        )
      )
    );
    expect(out).toBe('| H |\n| --- |\n| a \\| b<br/>c<br/>d |\n');
  });

  it('drops empty list items but keeps the numbering of the others', () => {
    const out = convertADFToMarkdown(
      doc({
        type: 'orderedList',
        content: [
          listItem(paragraph(text('one'))),
          listItem(paragraph()),
          listItem(paragraph(text('three'))),
        ],
      })
    );
    expect(out).toBe('1. one\n3. three');
  });

  it('renders blocks inside a panel on separate lines', () => {
    const out = convertADFToMarkdown(
      doc({
        type: 'panel',
        content: [
          paragraph(text('Base situation:')),
          { type: 'bulletList', content: [listItem(paragraph(text('item')))] },
        ],
      })
    );
    expect(out).toBe('Base situation:\n\n- item');
  });

  it('renders an expand title in bold above its content', () => {
    const out = convertADFToMarkdown(
      doc({
        type: 'expand',
        attrs: { title: 'Details' },
        content: [paragraph(text('body'))],
      })
    );
    expect(out).toBe('**Details**\nbody\n');
  });

  it('pads a merged cell with empty cells so the row keeps the column count', () => {
    const out = convertADFToMarkdown(
      doc({
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: ['A', 'B', 'C'].map((h) => ({
              type: 'tableHeader',
              content: [paragraph(text(h))],
            })),
          },
          {
            type: 'tableRow',
            content: [
              {
                type: 'tableHeader',
                attrs: { colspan: 2 },
                content: [paragraph(text('wide'))],
              },
              { type: 'tableCell', content: [paragraph()] },
            ],
          },
        ],
      })
    );
    expect(out).toBe('| A | B | C |\n| --- | --- | --- |\n| wide |  |  |\n');
  });

  it('renders a heading inside a cell as bold text', () => {
    const out = convertADFToMarkdown(
      doc(
        table(
          [[paragraph(text('Field'))]],
          [
            [
              {
                type: 'heading',
                attrs: { level: 3 },
                content: [text('Patient level')],
              },
            ],
          ]
        )
      )
    );
    expect(out).toBe('| Field |\n| --- |\n| **Patient level** |\n');
  });
});

describe('convertADFToMarkdown marks', () => {
  it('moves surrounding whitespace outside emphasis markers', () => {
    const out = convertADFToMarkdown(
      doc(paragraph(text('entry'), text(' +€10 ', [{ type: 'strong' }]), text('done')))
    );
    expect(out).toBe('entry **+€10** done\n');
  });

  it('leaves whitespace-only marked text unmarked', () => {
    expect(
      convertADFToMarkdown(doc(paragraph(text('a'), text(' ', [{ type: 'em' }]), text('b'))))
    ).toBe('a b\n');
  });
});

describe('convertADFToMarkdown nested lists and table spacing', () => {
  const listItem = (...content: unknown[]) => ({ type: 'listItem', content });
  const nested = {
    type: 'orderedList',
    content: [
      listItem(paragraph(text('parent')), {
        type: 'bulletList',
        content: [listItem(paragraph(text('child')))],
      }),
    ],
  };

  it('indents a nested list under its parent item', () => {
    expect(convertADFToMarkdown(doc(nested))).toBe('1. parent\n   - child');
  });

  it('keeps nested list indentation inside a table cell as non-breaking spaces', () => {
    const cell = (...content: unknown[]) => ({ type: 'tableCell', content });
    const out = convertADFToMarkdown(
      doc({
        type: 'table',
        content: [
          { type: 'tableRow', content: [cell(paragraph(text('H')))] },
          { type: 'tableRow', content: [cell(nested)] },
        ],
      })
    );
    expect(out).toBe('| H |\n| --- |\n| 1. parent<br/>&nbsp;&nbsp;&nbsp;- child |\n');
  });

  it('separates a top-level table from the following paragraph with a blank line', () => {
    const cell = { type: 'tableCell', content: [paragraph(text('H'))] };
    const out = convertADFToMarkdown(
      doc(
        { type: 'table', content: [{ type: 'tableRow', content: [cell] }] },
        paragraph(text('after'))
      )
    );
    expect(out).toBe('| H |\n| --- |\n\nafter\n');
  });
});
