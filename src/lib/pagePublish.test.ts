import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { localAttachments, sidecarPath, splitTitle } from './pagePublish.js';
import { reportToWiki } from './qaReport.js';

describe('splitTitle', () => {
  it('takes the first heading as title and drops it and the frontmatter from the body', () => {
    expect(splitTitle('---\nkey: x\n---\n# ZOD-1 context\n\n## Flow\n\ntext\n', 'a/context.md')).toEqual({ title: 'ZOD-1 context', body: '## Flow\n\ntext' });
  });

  it('falls back to the file name', () => {
    expect(splitTitle('## Only sections\n', 'a/notes.md').title).toBe('notes');
  });
});

describe('localAttachments', () => {
  const base = path.resolve('docs');
  const exists = (p: string) => [path.join(base, 'flow.png'), path.join(base, 'img', 'flow.png'), path.join(base, 'run.json')].includes(p);

  it('rewrites existing local images and files to attachments, leaving URLs and missing files alone', () => {
    const { body, files } = localAttachments('![f](flow.png) ![g](img/flow.png) [run](run.json) [web](https://e.com) [gone](x.png) [top](#flow)', base, exists);
    expect(body).toBe('![f](attachments/flow.png) ![g](attachments/flow-2.png) [run](attachments/run.json) [web](https://e.com) [gone](x.png) [top](#flow)');
    expect([...files.keys()]).toEqual(['flow.png', 'flow-2.png', 'run.json']);
  });
});

describe('sidecarPath', () => {
  it('sits next to the file', () => {
    expect(sidecarPath(path.join('a', 'context.md'))).toBe(path.join('a', '.context.md.confluence.json'));
  });
});

describe('reportToWiki code blocks', () => {
  it('keeps braces in code blocks unescaped', () => {
    expect(reportToWiki('```json\n{"a":1}\n```\n\nPUT series/{id}')).toBe('{code:json}\n{"a":1}\n{code}\n\nPUT series/\\{id\\}');
  });
});
