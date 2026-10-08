// After the build: make /docs/ work as one page. Every synced doc is rendered into its own
// <section data-doc="<slug>"> on dist/docs/index.html; each doc's headings were given ids by the
// markdown renderer as if it were alone, so two docs can both have "#prerequisites". This prefixes
// every id inside a section with its slug ("#install-prerequisites") and rewrites links to match:
//   href="#frag"               -> href="#<slug>-frag"        (a link within the same doc)
//   href="/docs/<s>/#frag"     -> href="#<s>-frag"           (a link to another doc's heading)
//   href="/docs/<s>/"          -> href="#<s>"                (a link to another doc)
// Links outside the sections (header, index, contents) are written as anchors in the page source.
// It refuses (exit 1) if an id would still be duplicated, or a rewritten anchor has no target.
import { readFileSync, writeFileSync } from 'node:fs';

const FILE = new URL('../dist/docs/index.html', import.meta.url).pathname;
let html = readFileSync(FILE, 'utf8');
const slugs = [...html.matchAll(/<section[^>]*data-doc="([^"]+)"/g)].map((m) => m[1]);
if (!slugs.length) fail('no <section data-doc> found in dist/docs/index.html');

const rewriteHref = (slug, href) => {
  if (href.startsWith('#')) return `#${slug}-${href.slice(1)}`;
  const m = href.match(/^\/docs\/([^/#]+)\/(?:#(.*))?$/);
  if (m && slugs.includes(m[1])) return m[2] ? `#${m[1]}-${m[2]}` : `#${m[1]}`;
  return href;
};

for (const slug of slugs) {
  const open = html.search(new RegExp(`<section[^>]*data-doc="${slug}"`));
  const close = html.indexOf('</section>', open);
  if (open < 0 || close < 0) fail(`section ${slug} not found`);
  // the section tag itself keeps id="<slug>"; only what is inside it is rewritten
  const tagEnd = html.indexOf('>', open) + 1;
  let body = html.slice(tagEnd, close);
  body = body.replace(/\sid="([^"]+)"/g, (_, id) => ` id="${slug}-${id}"`);
  body = body.replace(/\s(aria-describedby|aria-labelledby)="([^"]+)"/g, (_, a, ids) => ` ${a}="${ids.split(/\s+/).map((i) => `${slug}-${i}`).join(' ')}"`);
  body = body.replace(/\shref="([^"]+)"/g, (_, href) => ` href="${rewriteHref(slug, href)}"`);
  html = html.slice(0, tagEnd) + body + html.slice(close);
}

// a comparison table whose top-left header cell is empty has its row labels in the first column:
// mark them as row headers, so every data cell has a header (screen readers, and axe's
// td-has-header)
html = html.replace(/<table>([\s\S]*?)<\/table>/g, (t, inner) => {
  if (!/<thead>\s*<tr>\s*<th[^>]*>\s*<\/th>/.test(inner)) return t;
  const body = inner.replace(/(<tbody>[\s\S]*?<\/tbody>)/, (tb) => tb.replace(/<tr>\s*<td([^>]*)>([\s\S]*?)<\/td>/g, '<tr><th scope="row"$1>$2</th>'));
  return `<table>${body.replace(/<thead>\s*<tr>\s*<th([^>]*)>\s*<\/th>/, '<thead><tr><td$1></td>')}</table>`;
});

// images in the docs: give each a size (so it can't shift the page as it loads) and load it lazily.
// Sizes come from the image itself (an SVG's width/height or viewBox); one that can't be read is
// left as it was, with a warning.
const imgs = [...new Set([...html.matchAll(/<img (?![^>]*\swidth=)[^>]*src="(https:\/\/raw\.githubusercontent\.com\/[^"]+)"[^>]*>/g)].map((m) => m[1]))];
for (const src of imgs) {
  let size = null;
  try {
    const svg = await (await fetch(src, { signal: AbortSignal.timeout(8000) })).text();
    const wh = svg.match(/<svg[^>]*\swidth="(\d+(?:\.\d+)?)"[^>]*\sheight="(\d+(?:\.\d+)?)"/);
    const vb = svg.match(/viewBox="[\d.\s-]*?\s([\d.]+)\s([\d.]+)"/);
    if (wh) size = [wh[1], wh[2]];
    else if (vb) size = [vb[1], vb[2]];
  } catch {}
  if (!size) {
    console.warn(`docs-anchors: no size for ${src}`);
    continue;
  }
  html = html.split(`src="${src}"`).join(`src="${src}" width="${Math.round(size[0])}" height="${Math.round(size[1])}" loading="lazy" decoding="async"`);
}

// checks: unique ids; every in-page anchor has a target; no links left to removed doc pages
const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
if (dup.length) fail(`duplicate ids: ${[...new Set(dup)].join(', ')}`);
const idset = new Set(ids);
const dead = [...html.matchAll(/\shref="#([^"]*)"/g)].map((m) => m[1]).filter((a) => a && !idset.has(a));
if (dead.length) fail(`in-page links with no target: ${[...new Set(dead)].join(', ')}`);
const stale = [...html.matchAll(/\shref="(\/docs\/[^"#]+\/[^"]*)"/g)].map((m) => m[1]);
if (stale.length) fail(`links to removed doc pages: ${[...new Set(stale)].join(', ')}`);

writeFileSync(FILE, html);
console.log(`docs anchors ok: ${slugs.length} sections, ${ids.length} unique ids`);

function fail(msg) {
  console.error(`docs-anchors: ${msg}`);
  process.exit(1);
}
