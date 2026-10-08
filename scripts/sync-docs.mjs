// Pulls the OrchestraOS docs into src/content/docs at the sha pinned in docs.lock.json.
//
//   node scripts/sync-docs.mjs                 re-sync at the pinned sha
//   node scripts/sync-docs.mjs --ref main      resolve a branch/tag to a sha, pin it, sync
//   node scripts/sync-docs.mjs --check         no network: fail if the committed docs do not
//                                              match the lock (runs before every build)
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const LOCK = join(ROOT, 'docs.lock.json');
const OUT = join(ROOT, 'src/content/docs');
const REPO = 'Tulum-DAO/orchestraos';

// source path in the repo -> site slug, title, nav order
export const DOCS = [
  // a novice starts here: what a terminal is, then the install (pm-tulumdao, Shaw's from-scratch brief)
  { src: 'docs/BEGINNERS_GUIDE.md', slug: 'beginners-guide', title: "Beginner's guide" },
  { src: 'docs/INSTALL.md', slug: 'install', title: 'Install: the minimum path' },
  { src: 'README.md', slug: 'overview', title: 'Overview' },
  { src: 'docs/COSTS.md', slug: 'costs', title: 'What it costs' },
  { src: 'docs/ONBOARDING.md', slug: 'onboarding', title: 'Connect your phone and browser' },
  { src: 'docs/UPGRADE.md', slug: 'upgrade', title: 'Upgrade' },
  { src: 'docs/REFERENCE_INSTALL.md', slug: 'reference-install', title: 'The reference install' },
  { src: 'docs/ARCHITECTURE.md', slug: 'architecture', title: 'Architecture' },
  { src: 'docs/ROTATION.md', slug: 'rotation', title: 'Rotation' },
];

// Strings that must never reach the public site, whatever the upstream docs say.
const DENY = [/tail[0-9a-f]{6}\.ts\.net/i, /srv1397016/i, /\b100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+\b/, /arkdata/i];

const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const args = process.argv.slice(2);
const lock = existsSync(LOCK) ? JSON.parse(readFileSync(LOCK, 'utf8')) : null;

if (args.includes('--check')) {
  if (!lock) fail('docs.lock.json is missing; run npm run sync-docs -- --ref main');
  for (const d of DOCS) {
    const p = join(OUT, `${d.slug}.md`);
    if (!existsSync(p)) fail(`${p} is missing; run npm run sync-docs`);
    if (sha256(readFileSync(p, 'utf8')) !== lock.files[d.slug]) fail(`${d.slug}.md was edited by hand or is stale; run npm run sync-docs`);
  }
  console.log(`docs ok: ${REPO}@${lock.sha.slice(0, 10)}`);
  process.exit(0);
}

const refIdx = args.indexOf('--ref');
let sha = lock?.sha;
if (refIdx >= 0) {
  const ref = args[refIdx + 1];
  const out = execFileSync('git', ['ls-remote', `https://github.com/${REPO}.git`, ref], { encoding: 'utf8' });
  sha = out.split(/\s/)[0];
  if (!/^[0-9a-f]{40}$/.test(sha || '')) fail(`could not resolve ${ref}`);
}
if (!sha) fail('no sha pinned; pass --ref main');

const tmp = mkdtempSync(join(tmpdir(), 'orchestraos-'));
execFileSync('git', ['init', '-q', tmp]);
execFileSync('git', ['-C', tmp, 'fetch', '-q', '--depth', '1', `https://github.com/${REPO}.git`, sha]);
const show = (path) => execFileSync('git', ['-C', tmp, 'show', `${sha}:${path}`], { encoding: 'utf8' });
const committedAt = execFileSync('git', ['-C', tmp, 'show', '-s', '--format=%cI', 'FETCH_HEAD'], { encoding: 'utf8' }).trim();

const bySrc = new Map(DOCS.map((d) => [d.src, d]));
const blob = (p) => `https://github.com/${REPO}/blob/${sha}/${p}`;
const raw = (p) => `https://raw.githubusercontent.com/${REPO}/${sha}/${p}`;

// resolve a repo-relative path written inside `from` (a source path) to a repo-root path
function resolve(from, target) {
  const base = from.includes('/') ? from.slice(0, from.lastIndexOf('/') + 1) : '';
  const parts = (base + target).split('/');
  const out = [];
  for (const p of parts) p === '..' ? out.pop() : p !== '.' && out.push(p);
  return out.join('/');
}

function linkFor(path) {
  const [p, hash] = path.split('#');
  const d = bySrc.get(p);
  if (d) return `/docs/${d.slug}/${hash ? '#' + hash.toLowerCase() : ''}`;
  return blob(p) + (hash ? '#' + hash : '');
}

function transform(src, md) {
  const lines = md.split('\n');
  let fence = null;
  return lines
    .map((line) => {
      const f = line.match(/^\s*(`{3,}|~{3,})/);
      if (f) {
        if (!fence) fence = f[1];
        else if (line.trim().startsWith(fence)) fence = null;
        return line;
      }
      if (fence) return line;
      // markdown links and images with relative targets
      line = line.replace(/(!?)\[([^\]]*)\]\((?!https?:|mailto:|#)([^)\s]+)\)/g, (_, bang, text, target) => {
        const p = resolve(src, target);
        return bang ? `![${text}](${raw(p)})` : `[${text}](${linkFor(p)})`;
      });
      // inline-code mentions of repo docs, e.g. `docs/INSTALL.md` or `docs/INSTALL.md` §0
      line = line.replace(/(?<!\[)`((?:docs\/)?[A-Za-z0-9_./-]+\.md)`(?!\])/g, (m, p) => {
        const full = p.startsWith('docs/') || p === 'README.md' ? p : resolve(src, p);
        if (!bySrc.has(full) && !full.startsWith('docs/')) return m;
        return `[\`${p}\`](${linkFor(full)})`;
      });
      return line;
    })
    .join('\n');
}

// The hero's install command comes from INSTALL.md section 1, never from memory.
const installMd = show('docs/INSTALL.md');
const clone = installMd.match(/^git clone https:\/\/github\.com\/Tulum-DAO\/orchestraos\.git.*$/m)?.[0];
const make = installMd.match(/^make install\b/m)?.[0];
if (!clone || !make) fail('could not find the clone + make install lines in docs/INSTALL.md');
const install = [clone.trim(), make.trim()];

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const files = {};
DOCS.forEach((d, i) => {
  let body = transform(d.src, show(d.src));
  for (const re of DENY) if (re.test(body)) fail(`${d.src} contains a private string matching ${re}; refusing to publish it`);
  // the page renders its own h1 from the title; drop the doc's first h1
  body = body.replace(/^# .*\n+/, '');
  const fm = ['---', `title: ${JSON.stringify(d.title)}`, `source: ${JSON.stringify(d.src)}`, `order: ${i}`, '---', ''].join('\n');
  const text = fm + body;
  writeFileSync(join(OUT, `${d.slug}.md`), text);
  files[d.slug] = sha256(text);
});
for (const f of readdirSync(OUT)) if (!files[f.replace(/\.md$/, '')]) fail(`unexpected file ${f}`);
writeFileSync(LOCK, JSON.stringify({ repo: REPO, sha, committedAt, install, syncedAt: new Date().toISOString(), files }, null, 2) + '\n');
rmSync(tmp, { recursive: true, force: true });
console.log(`synced ${DOCS.length} docs from ${REPO}@${sha.slice(0, 10)} (${committedAt})`);

function fail(msg) {
  console.error(`sync-docs: ${msg}`);
  process.exit(1);
}
