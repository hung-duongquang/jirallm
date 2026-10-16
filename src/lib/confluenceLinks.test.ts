import { describe, expect, it } from 'vitest';
import {
  collectConfluenceRefs,
  parseConfluenceUrl,
  rewriteConfluenceLinks,
  tinyLinkToPageId,
} from './confluenceLinks.js';

const SITE = 'https://acme.atlassian.net';

describe('tinyLinkToPageId', () => {
  it('decodes short links to the page ids Confluence redirects them to', () => {
    expect(tinyLinkToPageId('zoV3O')).toBe('947357134');
    expect(tinyLinkToPageId('4oAZXQ')).toBe('1561952482');
    expect(tinyLinkToPageId('vgDLkg')).toBe('2462777534');
    expect(tinyLinkToPageId('QgAJZg')).toBe('1711865922');
  });

  it('rejects anything that is not a short link id', () => {
    expect(tinyLinkToPageId('a b')).toBeUndefined();
    expect(tinyLinkToPageId('AAAA')).toBeUndefined();
  });
});

describe('parseConfluenceUrl', () => {
  it('recognises page, short link, viewpage and whiteboard URLs', () => {
    expect(parseConfluenceUrl(`${SITE}/wiki/spaces/ZOD/pages/2297398151/Payable+Claim`)).toEqual({
      origin: SITE,
      kind: 'page',
      id: '2297398151',
    });
    expect(parseConfluenceUrl(`${SITE}/wiki/spaces/ZOD/pages/123#Section`)?.id).toBe('123');
    expect(parseConfluenceUrl(`${SITE}/wiki/x/zoV3O?xpis=abc`)).toEqual({
      origin: SITE,
      kind: 'page',
      id: '947357134',
    });
    expect(parseConfluenceUrl(`${SITE}/wiki/pages/viewpage.action?pageId=42`)?.id).toBe('42');
    expect(
      parseConfluenceUrl(`${SITE}/wiki/spaces/ZOD/whiteboard/2372468922?whiteboard-linked-object=x`)
    ).toEqual({ origin: SITE, kind: 'whiteboard', id: '2372468922' });
  });

  it('ignores other URLs', () => {
    expect(parseConfluenceUrl(`${SITE}/browse/ZOD-1`)).toBeUndefined();
    expect(parseConfluenceUrl(`${SITE}/wiki/spaces/ZOD/overview`)).toBeUndefined();
    expect(parseConfluenceUrl('not a url')).toBeUndefined();
  });
});

describe('collectConfluenceRefs', () => {
  it('finds links and bare URLs once each, without trailing punctuation', () => {
    const md = [
      `Test failed refer ${SITE}/wiki/x/zoV3O.`,
      `See [the spec](${SITE}/wiki/spaces/ZOD/pages/947357134/Spec) and ${SITE}/wiki/spaces/ZOD/whiteboard/7`,
    ].join('\n');
    expect(collectConfluenceRefs(md)).toEqual([
      { origin: SITE, kind: 'page', id: '947357134', url: `${SITE}/wiki/x/zoV3O` },
      { origin: SITE, kind: 'whiteboard', id: '7', url: `${SITE}/wiki/spaces/ZOD/whiteboard/7` },
    ]);
  });
});

describe('rewriteConfluenceLinks', () => {
  const resolve = (ref: { kind: string; id: string }) => {
    if (ref.id === '1') return { title: 'Spec [v2]', path: '../confluence/1-spec/page.md' };
    if (ref.id === '7') return { title: 'Upload flow' };
    return undefined;
  };

  it('points known pages at their local copy, titling links that only show the URL', () => {
    const md = [
      `Refer ${SITE}/wiki/spaces/ZOD/pages/1/Spec.`,
      `[${SITE}/wiki/spaces/ZOD/pages/1](${SITE}/wiki/spaces/ZOD/pages/1)`,
      `[the spec](${SITE}/wiki/spaces/ZOD/pages/1)`,
    ].join('\n');
    expect(rewriteConfluenceLinks(md, resolve)).toBe(
      [
        'Refer [Spec \\[v2\\]](../confluence/1-spec/page.md).',
        '[Spec \\[v2\\]](../confluence/1-spec/page.md)',
        '[the spec](../confluence/1-spec/page.md)',
      ].join('\n')
    );
  });

  it('titles whiteboards but keeps their Confluence URL, and leaves unknown items alone', () => {
    const board = `${SITE}/wiki/spaces/ZOD/whiteboard/7`;
    const other = `${SITE}/wiki/spaces/ZOD/pages/99/Other`;
    expect(rewriteConfluenceLinks(`[Whiteboard](${board}) and ${other}`, resolve)).toBe(
      `[Whiteboard: Upload flow](${board}) and ${other}`
    );
  });
});
