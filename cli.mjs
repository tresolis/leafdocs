#!/usr/bin/env node

import {copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync} from 'fs';
import {dirname, join, resolve} from 'path';
import {fileURLToPath} from 'url';
import {parseArgs} from 'node:util';
import {marked} from 'marked';

const __dirname = dirname(fileURLToPath(import.meta.url));

const cdn = JSON.parse(readFileSync(join(__dirname, 'cdn.json'), 'utf8'));
function cdnScript(key) {
  const d = cdn[key];
  const url = d.url.replace('{version}', d.version);
  return `<script src="${url}" integrity="${d.integrity}" crossorigin="anonymous"></script>`;
}

const { values: args, positionals } = parseArgs({
  options: {
    root:  { type: 'string', short: 'r' },
    pages: { type: 'string', short: 'p' },
    out:   { type: 'string', short: 'o' },
    page:  { type: 'string', short: 'g' },
  },
  allowPositionals: true,
  strict: false,
});

// ── Init command ──────────────────────────────────────────────────────────────

if (positionals[0] === 'init') {
  const target = resolve(positionals[1] ?? '.');
  const files = {
    'pages/header.md': `---\ntitle: My Docs\n---\n\n[Getting Started](getting-started)\n`,
    'pages/footer.md': `© ${new Date().getFullYear()} My Company\n`,
    'pages/index.md': `---\ntitle: My Docs\n---\n\n# Welcome\n\nWelcome to the documentation.\n`,
    'pages/getting-started/01-introduction.md': `---\ntitle: Introduction\n---\n\n# Introduction\n\nThis is your first page.\n`,
    'css/main.css': `/* Add your styles here */\n`,
    'assets/.gitkeep': '',
    'openapi/.gitkeep': '',
    'vite.config.js': `import tailwindcss from '@tailwindcss/vite'\nimport leafdocs from 'leafdocs/vite'\n\nexport default leafdocs({\n  plugins: [tailwindcss()],\n})\n`,
    'package.json': JSON.stringify({
      name: 'docs',
      version: '0.0.0',
      private: true,
      type: 'module',
      scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview' },
      devDependencies: { leafdocs: 'latest', '@tailwindcss/vite': 'latest', tailwindcss: 'latest', vite: 'latest' },
    }, null, 2) + '\n',
    '.gitignore': `/dist/\n/dist-prod/\n/node_modules/\n`,
  };

  let created = 0;
  for (const [rel, content] of Object.entries(files)) {
    const dest = join(target, rel);
    if (existsSync(dest)) { console.log(`  skip  ${rel}`); continue; }
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, content);
    console.log(`  create ${rel}`);
    created++;
  }
  console.log(`\n✅ ${created} file(s) created in ${target}\n`);
  console.log('Next steps:\n  pnpm install\n  pnpm dev\n');
  process.exit(0);
}

const DOCS_DIR   = resolve(args.root ?? (args.pages ? dirname(args.pages) : process.cwd()));
const PAGES_DIR  = resolve(args.pages ?? join(DOCS_DIR, 'pages'));
const OUT_DIR    = resolve(args.out   ?? join(DOCS_DIR, 'dist'));
const OPENAPI_DIR = join(DOCS_DIR, 'openapi');

const LOGO_EXTS = ['svg', 'png', 'webp', 'avif', 'jpg', 'jpeg', 'gif'];
const logoFile  = LOGO_EXTS.map(e => `logo.${e}`).find(f => existsSync(join(DOCS_DIR, 'assets', f))) ?? null;

// ── Frontmatter ───────────────────────────────────────────────────────────────

function parseFrontmatter(content) {
  const m = content.replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: content.replace(/\r\n/g, '\n') };
  const meta = {};
  for (const line of m[1].split('\n')) {
    const col = line.indexOf(':');
    if (col === -1) continue;
    const key = line.slice(0, col).trim();
    const val = line.slice(col + 1).trim().replace(/^["']|["']$/g, '');
    if (key) meta[key] = val;
  }
  return { meta, body: m[2] };
}

// ── Heading renderer — adds id attributes ─────────────────────────────────────

const renderer = new marked.Renderer();
renderer.heading = function ({ text, depth }) {
  const id = text.toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/[\s]+/g, '-');
  return `<h${depth} id="${id}">${text}</h${depth}>\n`;
};
marked.use({ renderer });

// ── Fix relative paths in rendered HTML for section pages (depth 1) ──────────
function fixRelativePaths(html) {
  return html
    .replace(/src="(?!https?:\/\/|\/|\.\.\/)(.*?)"/g, 'src="../$1"')
    .replace(/href="(?!https?:\/\/|\/|\.\.\/|#)(.*?)"/g, 'href="../$1"');
}

// ── Parse header.md → site title + ordered sections ──────────────────────────

function parseHeader() {
  const raw = readFileSync(join(PAGES_DIR, 'header.md'), 'utf8');
  const { meta, body } = parseFrontmatter(raw);
  const sections = [];
  for (const m of body.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)) {
    sections.push({ label: m[1], slug: m[2] });
  }
  return { siteTitle: meta.title || 'Documentation', sections };
}

// ── Parse footer.md ──────────────────────────────────────────────────────────

function parseFooter() {
  const html = join(PAGES_DIR, 'footer.html')
  if (existsSync(html)) return readFileSync(html, 'utf8').trim()
  const md = join(PAGES_DIR, 'footer.md')
  if (!existsSync(md)) return null
  const { body } = parseFrontmatter(readFileSync(md, 'utf8'))
  return marked(body).trim()
}

// ── Collect pages per section, sorted by filename ─────────────────────────────

function collectPages(sections) {
  const all = [];
  for (const section of sections) {
    const dir = join(PAGES_DIR, section.slug);
    let files = [];
    try { files = readdirSync(dir).filter(f => f.endsWith('.md')).sort(); } catch { continue; }
    for (const file of files) {
      const raw = readFileSync(join(dir, file), 'utf8');
      const { meta, body } = parseFrontmatter(raw);
      const urlSlug = file.replace(/^\d+-/, '').replace(/\.md$/, '');
      all.push({ section: section.slug, sectionLabel: section.label, file, urlSlug, meta, body });
    }
  }
  return all;
}

// ── Parse OpenAPI info block (title, version) without a full YAML parser ──────

function parseOpenApiInfo(content, isJson) {
  if (isJson) {
    try {
      const spec = JSON.parse(content);
      return { title: spec.info?.title || 'API', version: spec.info?.version || '' };
    } catch { return { title: 'API', version: '' }; }
  }
  const lines = content.split('\n');
  let inInfo = false;
  const info = {};
  for (const line of lines) {
    if (/^info:/.test(line)) { inInfo = true; continue; }
    if (inInfo && /^[a-z]/.test(line)) break;
    if (inInfo) {
      const m = line.match(/^\s{2}(title|version):\s*(.+)/);
      if (m) info[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  }
  return { title: info.title || 'API', version: info.version || '' };
}

// ── Collect OpenAPI specs from openapi/ directory ─────────────────────────────

function collectApiSpecs() {
  if (!existsSync(OPENAPI_DIR)) return [];
  return readdirSync(OPENAPI_DIR)
    .filter(f => /\.(ya?ml|json)$/.test(f))
    .sort()
    .map(file => {
      const content = readFileSync(join(OPENAPI_DIR, file), 'utf8');
      const info = parseOpenApiInfo(content, file.endsWith('.json'));
      const slug = file.replace(/\.(ya?ml|json)$/, '');
      return { ...info, slug, file };
    });
}

// ── Extract h2/h3 from rendered HTML for right-side TOC ──────────────────────

function extractToc(html) {
  const toc = [];
  for (const m of html.matchAll(/<h([23]) id="([^"]*)"[^>]*>([\s\S]*?)<\/h\d>/g)) {
    toc.push({ level: parseInt(m[1]), id: m[2], text: m[3].replace(/<[^>]+>/g, '') });
  }
  return toc;
}

// ── Resolve href from a section page (depth 1) to another section's first page

function sectionHref(allPages, targetSlug) {
  const first = allPages.find(p => p.section === targetSlug);
  return first ? `../${targetSlug}/${first.urlSlug}.html` : `../${targetSlug}/`;
}

// ── Shared header HTML (depth 0 = index, depth 1 = section/api page) ─────────

function renderHeader({ siteTitle, sections, allPages, apiSpecs, activeSection, depth }) {
  const prefix = depth === 0 ? '' : '../';
  const logo   = logoFile
    ? `<img src="${prefix}assets/${logoFile}" alt="${siteTitle}" class="site-logo">`
    : siteTitle;

  const sectionLinks = sections.map(s => {
    const href = depth === 0
      ? (allPages.find(p => p.section === s.slug) ? `${s.slug}/${allPages.find(p => p.section === s.slug).urlSlug}.html` : `${s.slug}/`)
      : sectionHref(allPages, s.slug);
    const active = s.slug === activeSection ? ' active' : '';
    return `<a href="${href}" class="hdr-link${active}">${s.label}</a>`;
  }).join('');

  const apiLink = apiSpecs.length
    ? `<a href="${prefix}api/${apiSpecs[0].slug}.html" class="hdr-link${activeSection === '__api__' ? ' active' : ''}">API</a>`
    : '';

  return `<header class="site-hdr">
    <a href="${prefix}index.html" class="site-name">${logo}</a>
    <nav class="hdr-links">${sectionLinks}${apiLink}</nav>
    <div class="hdr-search"><pagefind-searchbox></pagefind-searchbox></div>
  </header>`;
}

// ── Page HTML template ────────────────────────────────────────────────────────

function renderPage({ siteTitle, sections, allPages, apiSpecs, activeSection, pageTitle, sectionPages, activeUrlSlug, content, toc, prev, next, cssFiles = [], footer = null }) {
  const cssLinks = cssFiles.map(f => `  <link rel="stylesheet" href="../css/${f}">`).join('\n');
  const header   = renderHeader({ siteTitle, sections, allPages, apiSpecs, activeSection, depth: 1 });

  const sidebarItems = sectionPages.map((p, i) =>
    `<a href="${p.urlSlug}.html" class="sb-item${p.urlSlug === activeUrlSlug ? ' active' : ''}">
      <span class="sb-num">${String(i + 1).padStart(2, '0')}</span>
      <span>${p.meta.title || p.urlSlug}</span>
    </a>`
  ).join('');

  const tocHtml = toc.length
    ? `<aside class="toc">
        <p class="toc-hdr">On this page</p>
        ${toc.map(h => `<a href="#${h.id}" class="toc-lnk toc-h${h.level}">${h.text}</a>`).join('')}
      </aside>`
    : '';

  const prevBox = prev
    ? `<a href="${prev.urlSlug}.html" class="nav-box nav-prev"><span class="nav-dir">← Previous</span><span class="nav-title">${prev.meta.title || prev.urlSlug}</span></a>`
    : '<div></div>';
  const nextBox = next
    ? `<a href="${next.urlSlug}.html" class="nav-box nav-next"><span class="nav-dir">Next →</span><span class="nav-title">${next.meta.title || next.urlSlug}</span></a>`
    : '<div></div>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${pageTitle} — ${siteTitle}</title>
  <link rel="icon" href="/favicon.png">
${cssLinks}
  <link href="/pagefind/pagefind-component-ui.css" rel="stylesheet">
  <script src="/pagefind/pagefind-component-ui.js" type="module"></script>
</head>
<body>
  ${header}
  <div class="body-wrap">
    <nav class="sidebar">
      <p class="sb-section">${activeSection}</p>
      ${sidebarItems}
    </nav>
    <main class="content">
      <article class="prose">${content}</article>
      <div class="page-nav">${prevBox}${nextBox}</div>
    </main>
    ${tocHtml}
  </div>
  ${footer ? `<footer class="site-ftr"><div class="ftr-wrap">${footer}</div></footer>` : ''}
<script>
(function () {
  const links = document.querySelectorAll('.toc-lnk');
  if (!links.length) return;
  const map = new Map();
  links.forEach(a => { const el = document.getElementById(a.getAttribute('href').slice(1)); if (el) map.set(el, a); });
  let active = null;
  function setActive(a) {
    if (a === active) return;
    if (active) active.style.color = '';
    active = a;
    if (active) { active.style.color = '#0369a1'; active.style.fontWeight = '600'; }
  }
  function reset(a) { if (a !== active) { a.style.color = ''; a.style.fontWeight = ''; } }
  const io = new IntersectionObserver(entries => {
    entries.forEach(e => { if (e.isIntersecting) { setActive(map.get(e.target)); map.forEach((a, _) => reset(a)); } });
  }, { rootMargin: '-10% 0px -80% 0px', threshold: 0 });
  map.forEach((_, el) => io.observe(el));
})();
</script>
</body>
</html>`;
}

// ── API page HTML template ────────────────────────────────────────────────────

function renderApiPage({ siteTitle, sections, allPages, apiSpecs, spec, cssFiles = [] }) {
  const cssLinks = cssFiles.map(f => `  <link rel="stylesheet" href="../css/${f}">`).join('\n');
  const header   = renderHeader({ siteTitle, sections, allPages, apiSpecs, activeSection: '__api__', depth: 1 });
  const config   = JSON.stringify({
    url: `../openapi/${spec.file}`,
    customCss: ':root { --scalar-color-accent: #0ea5e9; --scalar-color-accent-contrast: #fff; }',
    hideModels: false,
    searchHotKey: 'k',
  });

  const sidebarItems = apiSpecs.map(s =>
    `<a href="${s.slug}.html" class="sb-item${s.slug === spec.slug ? ' active' : ''}">
      <span>${s.title}${s.version ? `<small class="sb-ver"> ${s.version}</small>` : ''}</span>
    </a>`
  ).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${spec.title}${spec.version ? ` ${spec.version}` : ''} — ${siteTitle}</title>
  <link rel="icon" href="/favicon.png">
${cssLinks}
</head>
<body style="margin:0">
  ${header}
  <div style="display:flex;height:calc(100vh - 56px)">
    <nav class="sidebar" style="overflow-y:auto;flex-shrink:0">
      <p class="sb-section">APIs</p>
      ${sidebarItems}
    </nav>
    <div id="api-ref" style="flex:1;overflow:auto;min-width:0"></div>
  </div>
  ${cdnScript('scalar-api-reference')}
  <script>
    Scalar.createApiReference(document.getElementById('api-ref'), ${config});
  </script>
</body>
</html>`;
}

// ── Index page ────────────────────────────────────────────────────────────────

function buildIndex(siteTitle, sections, allPages, apiSpecs, cssFiles = [], footer = null) {
  const cssLinks = cssFiles.map(f => `  <link rel="stylesheet" href="css/${f}">`).join('\n');
  let raw = '';
  try { raw = readFileSync(join(PAGES_DIR, 'index.md'), 'utf8'); } catch { raw = `# ${siteTitle}\n`; }
  const { meta, body } = parseFrontmatter(raw);
  const header = renderHeader({ siteTitle, sections, allPages, apiSpecs, activeSection: null, depth: 0 });

  writeFileSync(join(OUT_DIR, 'index.html'), `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${meta.title || siteTitle}</title>
  <link rel="icon" href="/favicon.png">
${cssLinks}
  <link href="/pagefind/pagefind-component-ui.css" rel="stylesheet">
  <script src="/pagefind/pagefind-component-ui.js" type="module"></script>
</head>
<body>
  ${header}
  <div class="index-hero">
    <div class="index-container">
      <article class="prose">${marked(body)}</article>
    </div>
  </div>
  ${footer ? `<footer class="site-ftr"><div class="ftr-wrap">${footer}</div></footer>` : ''}
</body>
</html>`);
  console.log('  ✓ dist/index.html');
}

// ── Build API section ─────────────────────────────────────────────────────────

function buildApiSection(siteTitle, sections, allPages, apiSpecs, cssFiles) {
  if (!apiSpecs.length) return;
  mkdirSync(join(OUT_DIR, 'api'), { recursive: true });
  copyDir(OPENAPI_DIR, join(OUT_DIR, 'openapi'));
  for (const spec of apiSpecs) {
    const html = renderApiPage({ siteTitle, sections, allPages, apiSpecs, spec, cssFiles });
    writeFileSync(join(OUT_DIR, 'api', `${spec.slug}.html`), html);
    console.log(`  ✓ api/${spec.slug}.html`);
  }
}

// ── Copy directory ────────────────────────────────────────────────────────────

function copyDir(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const s = join(src, entry.name);
    const d = join(dest, entry.name);
    entry.isDirectory() ? copyDir(s, d) : copyFileSync(s, d);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log('\n📄 Building docs…\n');

const { siteTitle, sections } = parseHeader();
const footer    = parseFooter();
const allPages  = collectPages(sections);
const apiSpecs  = collectApiSpecs();

mkdirSync(OUT_DIR, { recursive: true });

const cssDir   = join(DOCS_DIR, 'css');
const cssFiles = existsSync(cssDir) ? readdirSync(cssDir).filter(f => f.endsWith('.css')) : [];

// ── Single-page mode ──────────────────────────────────────────────────────────

if (args.page) {
  const targetFile = resolve(args.page);
  const page = allPages.find(p => resolve(join(PAGES_DIR, p.section, p.file)) === targetFile);
  if (!page) { console.error(`Page not found: ${args.page}`); process.exit(1); }

  const sectionPages = allPages.filter(p => p.section === page.section);
  const i = sectionPages.findIndex(p => p.file === page.file);
  const html = fixRelativePaths(marked(page.body));
  const toc = extractToc(html);

  mkdirSync(join(OUT_DIR, page.section), { recursive: true });
  writeFileSync(join(OUT_DIR, page.section, `${page.urlSlug}.html`), renderPage({
    siteTitle, sections, allPages, apiSpecs,
    activeSection: page.section,
    pageTitle: page.meta.title || page.urlSlug,
    sectionPages, activeUrlSlug: page.urlSlug,
    content: html, toc,
    prev: i > 0 ? sectionPages[i - 1] : null,
    next: i < sectionPages.length - 1 ? sectionPages[i + 1] : null,
    cssFiles, footer,
  }));
  console.log(`  ✓ ${page.section}/${page.urlSlug}.html\n`);
  process.exit(0);
}

// ── Full build ────────────────────────────────────────────────────────────────

console.log(`Sections : ${sections.map(s => s.slug).join(', ')}${apiSpecs.length ? ', API' : ''}`);
console.log(`Pages    : ${allPages.length} docs${apiSpecs.length ? ` + ${apiSpecs.length} API spec${apiSpecs.length > 1 ? 's' : ''}` : ''}\n`);

const assetsDir = join(DOCS_DIR, 'assets');
if (existsSync(cssDir))    { copyDir(cssDir, join(OUT_DIR, 'css')); console.log('  ✓ css/'); }
if (existsSync(assetsDir)) { copyDir(assetsDir, join(OUT_DIR, 'assets')); console.log('  ✓ assets/'); }
const faviconSrc = join(PAGES_DIR, 'favicon.png');
if (existsSync(faviconSrc)) { copyFileSync(faviconSrc, join(OUT_DIR, 'favicon.png')); console.log('  ✓ favicon.png'); }
console.log();

buildIndex(siteTitle, sections, allPages, apiSpecs, cssFiles, footer);
buildApiSection(siteTitle, sections, allPages, apiSpecs, cssFiles);

for (const section of sections) {
  const sectionPages = allPages.filter(p => p.section === section.slug);
  if (!sectionPages.length) continue;
  mkdirSync(join(OUT_DIR, section.slug), { recursive: true });

  for (let i = 0; i < sectionPages.length; i++) {
    const page = sectionPages[i];
    const html = fixRelativePaths(marked(page.body));
    const toc = extractToc(html);

    writeFileSync(join(OUT_DIR, section.slug, `${page.urlSlug}.html`), renderPage({
      siteTitle, sections, allPages, apiSpecs,
      activeSection: section.slug,
      pageTitle: page.meta.title || page.urlSlug,
      sectionPages, activeUrlSlug: page.urlSlug,
      content: html, toc,
      prev: i > 0 ? sectionPages[i - 1] : null,
      next: i < sectionPages.length - 1 ? sectionPages[i + 1] : null,
      cssFiles, footer,
    }));
    console.log(`  ✓ ${section.slug}/${page.urlSlug}.html`);
  }
}

console.log(`\n✅ Done — ${allPages.length} pages${apiSpecs.length ? ` + ${apiSpecs.length} API spec${apiSpecs.length > 1 ? 's' : ''}` : ''} → dist/\n`);
