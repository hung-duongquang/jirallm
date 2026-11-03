import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  SharePointClient,
  SharePointSessionError,
  canvasToMarkdown,
  cleanSummary,
  exportSharePointPage,
  parseCookieInput,
  parseSharePointPageUrl,
  searchSharePoint,
  sharePointQuery,
} from './sharepoint.js';

const ORIGIN = 'https://contoso.sharepoint.com';

/** Encodes JSON the way SharePoint stores it in data-sp-* attributes. */
function attr(value: unknown): string {
  return JSON.stringify(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/\{/g, '&#123;')
    .replace(/\}/g, '&#125;')
    .replace(/:/g, '&#58;');
}

function webPart(id: string, title: string, properties: Record<string, unknown>, sp: Record<string, unknown> = {}): string {
  const data = { id, title, properties, serverProcessedContent: { htmlStrings: {}, searchablePlainTexts: {}, imageSources: {}, links: {}, ...sp } };
  return `<div data-sp-canvascontrol="" data-sp-controldata="${attr({ controlType: 3 })}"><div data-sp-webpart="" data-sp-webpartdata="${attr(data)}"></div></div>`;
}

function text(html: string): string {
  return `<div data-sp-canvascontrol="" data-sp-controldata="${attr({ controlType: 4 })}"><div data-sp-rte="">${html}</div></div>`;
}

const CANVAS =
  '<div>' +
  webPart('8654b779-4886-46d4-8ffb-b5ed960ee986', 'Opvulling', { height: 12 }) +
  webPart('cbe7b0a9-3504-44dd-a3a3-0e5cacd07788', 'Banner', { title: 'Servicedesk' }) +
  text(
    '<h2>Nieuwe tickets</h2><p>Ga naar <a href="http://fb.example.nl/"><span style="color:red"><u>fb.example.nl</u></span></a> of <a href="/sites/AC/SitePages/Help.aspx">help</a>.</p>' +
      '<table><tbody><tr><td>App</td><td>Portal</td></tr><tr><td>Jira</td><td>FB</td></tr></tbody></table>'
  ) +
  webPart('d5f735d3-274a-4a18-998b-04dede36c861', 'Involv Call To Action', {
    description: 'InvolvCallToAction',
    bannerTitle: 'Jira & Confluence',
    bannerDescription: '',
    bannerBtnText: 'Vragen',
    bannerLink: 'https://jira.example/portal/1',
    bannerBtnText2: 'Account',
    bannerLink2: 'https://jira.example/portal/2',
    filePickerResultUpload: `${ORIGIN}/sites/AC/SiteAssets/tile.jpg`,
  }) +
  webPart('7f718435-ee4d-431c-bdbf-9c4ff326f46e', 'Personen', { layout: 1 }, {
    searchablePlainTexts: { title: 'Vragen? Neem contact op met:', 'persons[0].name': 'Miriam', 'persons[0].email': 'miriam@example.nl' },
  }) +
  webPart('c70391ea-0b10-4ee9-b2b4-006d3fcad0cd', 'Snelkoppelingen', { items: [] }, {
    searchablePlainTexts: { 'items[0].title': 'Healthcare', 'items[1].title': 'Finance' },
    links: { baseUrl: `${ORIGIN}/sites/Intranet`, 'items[0].sourceItem.url': '/sites/Zorg', 'items[1].sourceItem.url': '/sites/Finance' },
  }) +
  webPart('d1d91016-032f-456d-98a4-721247c305e8', 'Afbeelding', { altText: 'Team', captionText: 'Het team' }, {
    imageSources: { imageSource: '/sites/AC/SiteAssets/team.jpg' },
  }) +
  webPart('490d7c76-1824-45b2-9de3-676421c997fa', 'Insluiten', { embedCode: '<iframe src="https://feed.example/x" width="10"></iframe>' }) +
  webPart('9d8a33ab-ba5a-4b76-b8e2-c242a29d98c4', 'Involv News', { description: 'x', title: 'News', queryTemplate: '{searchTerms}' }) +
  webPart('567d9f25-37ea-4fef-852c-f01c0e308f06', 'Involv Button', { enableBackBtn: true, btnText: '< Terug' }) +
  '</div>';

describe('parseSharePointPageUrl', () => {
  it('splits a site page URL into web and file path', () => {
    const link = parseSharePointPageUrl(`${ORIGIN}/sites/IntranetAC/SitePages/en/Inlog-%26-AFAS.aspx?web=1`);
    expect(link).toEqual({
      origin: ORIGIN,
      webUrl: `${ORIGIN}/sites/IntranetAC`,
      serverRelativePath: '/sites/IntranetAC/SitePages/en/Inlog-&-AFAS.aspx',
      fileName: 'en/Inlog-&-AFAS.aspx',
      site: 'IntranetAC',
    });
  });

  it('rejects other URLs', () => {
    expect(() => parseSharePointPageUrl('https://example.com/SitePages/a.aspx')).toThrow(/Not a SharePoint URL/);
    expect(() => parseSharePointPageUrl(`${ORIGIN}/sites/X/Shared%20Documents/a.docx`)).toThrow(/page URL/);
  });
});

describe('parseCookieInput', () => {
  it('keeps FedAuth and rtFa from a cURL command', () => {
    const curl = `curl '${ORIGIN}/_api/web' -H 'accept: */*' -H 'cookie: MSFPC=1; rtFa=RT%2Bx; FedAuth=77u/abc==; other=2' --compressed`;
    expect(parseCookieInput(curl)).toBe('rtFa=RT%2Bx; FedAuth=77u/abc==');
  });

  it('reads the -b form of newer cURL copies and the fetch (Node.js) form', () => {
    expect(parseCookieInput(`curl '${ORIGIN}/x' -b 'FedAuth=f1; rtFa=r1' -H 'accept: */*'`)).toBe('FedAuth=f1; rtFa=r1');
    expect(parseCookieInput(`fetch("${ORIGIN}/x", { "headers": { "accept": "*/*", "cookie": "rtFa=r2; FedAuth=f2" } });`)).toBe('rtFa=r2; FedAuth=f2');
  });

  it('accepts a bare Cookie header and requires FedAuth', () => {
    expect(parseCookieInput('Cookie: FedAuth=a=b; x=1')).toBe('FedAuth=a=b');
    expect(() => parseCookieInput('rtFa=1')).toThrow(/FedAuth/);
  });
});

describe('canvasToMarkdown', () => {
  const { markdown, images } = canvasToMarkdown(CANVAS, { origin: ORIGIN });

  it('converts text sections with absolute links and a GFM table', () => {
    expect(markdown).toContain('## Nieuwe tickets');
    expect(markdown).toContain('Ga naar [fb.example.nl](http://fb.example.nl/) of [help](https://contoso.sharepoint.com/sites/AC/SitePages/Help.aspx).');
    expect(markdown).toMatch(/\| App \| Portal \|\n\| --- \| --- \|\n\| Jira \| FB \|/);
  });

  it('renders the stored content of web parts and names the dynamic ones', () => {
    expect(markdown).toContain('**Jira & Confluence**\n\n- [Vragen](https://jira.example/portal/1)\n- [Account](https://jira.example/portal/2)');
    expect(markdown).toContain('**Vragen? Neem contact op met:**\n\n- Miriam — <miriam@example.nl>');
    expect(markdown).toContain('- [Healthcare](https://contoso.sharepoint.com/sites/Zorg)\n- [Finance](https://contoso.sharepoint.com/sites/Finance)');
    expect(markdown).toContain('![Team](https://contoso.sharepoint.com/sites/AC/SiteAssets/team.jpg)\n\n_Het team_');
    expect(markdown).toContain('Embedded: <https://feed.example/x>');
    expect(markdown).toContain('_[Involv News: dynamic content, not exported]_');
    expect(images).toEqual(['https://contoso.sharepoint.com/sites/AC/SiteAssets/team.jpg']);
  });

  it('drops layout parts and back buttons', () => {
    expect(markdown).not.toMatch(/Opvulling|Banner|Terug|tile\.jpg|InvolvCallToAction/);
  });

  it('drops soft hyphens and hard breaks that end a paragraph', () => {
    const md = canvasToMarkdown(text('<p>\u00adBinnen Topicus.<br><br>Tweede regel<br>derde.</p>'), { origin: ORIGIN }).markdown;
    expect(md).toBe('Binnen Topicus.\n\nTweede regel  \nderde.');
  });

  it('tightens lists and unescapes dash paragraphs', () => {
    const md = canvasToMarkdown(text('<ul><li><strong>Pool</strong>: a<br>&nbsp;</li><li>b</li></ul><p>-&nbsp;&nbsp; Naam</p><p>- Tarief</p>'), { origin: ORIGIN }).markdown;
    expect(md).toBe('- **Pool**: a\n\n- b\n\n- Naam\n\n- Tarief');
  });

  it('falls back to plain HTML for classic pages', () => {
    expect(canvasToMarkdown('<p>Hello <b>world</b></p>', { origin: ORIGIN }).markdown).toBe('Hello **world**');
  });
});

describe('search', () => {
  it('limits to pages by default and scopes to a site', () => {
    expect(sharePointQuery('"functioneel beheer"')).toBe('"functioneel beheer" contentclass:STS_ListItem_WebPageLibrary');
    expect(sharePointQuery('x', { documents: true, site: `${ORIGIN}/sites/HR/SitePages/Home.aspx` })).toBe(`x path:"${ORIGIN}/sites/HR"`);
  });

  it('strips hit highlighting', () => {
    expect(cleanSummary('Navigeer <c0>functioneel</c0> beheer<ddd/>')).toBe('Navigeer functioneel beheer');
    expect(cleanSummary('<ddd/>servicedesk (via fb) aan<ddd/>de servicedesk (via fb) aan de achterkant<ddd/>Nieuw')).toBe(
      'de servicedesk (via fb) aan de achterkant … Nieuw'
    );
    expect(cleanSummary('x'.repeat(300)).length).toBe(200);
  });

  it('maps result rows', async () => {
    const calls: string[] = [];
    const fake = (async (url: string) => {
      calls.push(url);
      const row = (k: string, v: string) => ({ Key: k, Value: v });
      return new Response(
        JSON.stringify({
          PrimaryQueryResult: {
            RelevantResults: {
              TotalRows: 22,
              Table: { Rows: [{ Cells: [row('Title', 'FB'), row('Path', `${ORIGIN}/sites/AC/SitePages/FB.aspx`), row('LastModifiedTime', '2026-03-09T09:11:39Z'), row('SiteTitle', 'AC'), row('HitHighlightedSummary', '<c0>FB</c0> desk'), row('FileExtension', 'aspx')] }] },
            },
          },
        })
      );
    }) as unknown as typeof fetch;
    const res = await searchSharePoint(new SharePointClient({ cookie: 'FedAuth=x', origin: ORIGIN }, fake), 'fb', { max: 5 });
    expect(res.total).toBe(22);
    expect(res.hits).toEqual([{ modified: '2026-03-09', site: 'AC', title: 'FB', url: `${ORIGIN}/sites/AC/SitePages/FB.aspx`, summary: 'FB desk', type: 'aspx' }]);
    expect(decodeURIComponent(calls[0])).toContain("querytext='fb contentclass:STS_ListItem_WebPageLibrary'");
    expect(calls[0]).toContain('rowlimit=5');
  });
});

describe('SharePointClient', () => {
  it('reports an expired session on a login redirect', async () => {
    const fake = (async () => new Response(null, { status: 302, headers: { location: 'https://login.microsoftonline.com/' } })) as unknown as typeof fetch;
    await expect(new SharePointClient({ cookie: 'FedAuth=x', origin: ORIGIN }, fake).json(`${ORIGIN}/_api/web`)).rejects.toBeInstanceOf(SharePointSessionError);
  });
});

describe('exportSharePointPage', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('writes page.md with local images and keeps the previous copy on change', async () => {
    dir = mkdtempSync(join(tmpdir(), 'sp-'));
    let modified = '2026-03-09T09:11:39';
    const fake = (async (url: string) => {
      if (url.includes('/_api/web/GetFileByServerRelativePath')) {
        expect(decodeURIComponent(url)).toContain("@u='/sites/AC/SitePages/FB.aspx'");
        return new Response(
          JSON.stringify({ Id: 7, Title: 'Functioneel beheer', Description: 'Kies het goede portaal.', Modified: modified, PromotedState: 0, CanvasContent1: CANVAS, FieldValuesAsText: { Editor: 'Miriam' } })
        );
      }
      if (url.endsWith('/team.jpg')) return new Response(new Uint8Array([1, 2, 3]));
      throw new Error(`unexpected ${url}`);
    }) as unknown as typeof fetch;
    const client = new SharePointClient({ cookie: 'FedAuth=x', origin: ORIGIN }, fake);
    const url = `${ORIGIN}/sites/AC/SitePages/FB.aspx`;

    const first = await exportSharePointPage(url, { outputDir: dir, client });
    expect(first.path).toBe(join(dir, 'sharepoint', 'ac-fb', 'page.md'));
    expect(first.imageCount).toBe(1);
    const md = readFileSync(first.path, 'utf8');
    expect(md).toMatch(/^---\nsharepoint:\n {2}title: "Functioneel beheer"\n {2}site: "AC"\n {2}id: 7\n/);
    expect(md).toContain('# Functioneel beheer\n\nModified 2026-03-09 by Miriam · [Open in SharePoint](https://contoso.sharepoint.com/sites/AC/SitePages/FB.aspx)\n\n> Kies het goede portaal.');
    expect(md).toContain('![Team](./01-team.jpg)');
    expect(existsSync(join(dir, 'sharepoint', 'ac-fb', '01-team.jpg'))).toBe(true);

    const again = await exportSharePointPage(url, { outputDir: dir, client });
    expect(again.changed).toBe(false);
    modified = '2026-04-01T00:00:00';
    const changed = await exportSharePointPage(url, { outputDir: dir, client, images: false });
    expect(changed.changed).toBe(true);
    expect(readFileSync(join(dir, 'sharepoint', 'ac-fb', '.page.previous.md'), 'utf8')).toContain('2026-03-09');
  });
});
