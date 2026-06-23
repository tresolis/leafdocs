# Leafdocs 🍃

> Beautiful, functional documentation from plain Markdown — no configuration required.

Leafdocs is designed to be as simple as possible: add a folder, drop in numbered Markdown files, get a polished documentation site. Convention over configuration throughout. Fully themable with Tailwind CSS.

## ✨ Features

- 📁 **Convention over config** — numbered files become ordered pages; folder structure becomes the section nav; no routes to declare
- 🔍 **Full-text search** — [Pagefind](https://pagefind.app) built in and pre-configured, works out of the box
- 📄 **OpenAPI viewer** — drop YAML/JSON specs in `openapi/` and get a [Scalar](https://scalar.com) reference tab, automatically
- 🎨 **Fully themable** — built on Tailwind CSS; override design tokens and bring your own styles with no friction

## Quick start

Scaffold a new site in seconds:

```sh
npx leafdocs init               # scaffold in current directory
npx leafdocs init ./my-docs     # scaffold in a subdirectory
```

Then install dependencies and start the dev server:

```sh
npm install
npm run dev     # dev server → http://localhost:3000
npm run build   # production build → dist-prod/
```

The dev server watches for changes, new files, and deletions — the browser reloads automatically.

## Directory structure

Leafdocs maps your folder structure directly to site sections. Each subfolder of `pages/` becomes a section; files within are ordered by their numeric prefix.

```
docs/
  pages/
    header.md               # site title + ordered section list
    index.md                # home page
    footer.md               # optional footer shown on all pages
    getting-started/
      01-intro.md           # → /getting-started/intro.html
      02-installation.md
    api-reference/
      01-overview.md
  css/
    custom.css              # Tailwind + custom styles
  assets/                   # images, logo (logo.svg/png/webp auto-detected)
  openapi/                  # YAML/JSON specs → automatic API viewer tab
  vite.config.js
  package.json
```

## Vite plugin

Wrap your Vite config with `leafdocs()`. It handles everything: building pages, running Pagefind, serving the dev server, and watching for changes.

```js
// vite.config.js
import leafdocs from 'leafdocs/vite'
import tailwindcss from '@tailwindcss/vite'

export default leafdocs({
  plugins: [tailwindcss()],
})
```

## `header.md` — site title and sections

`header.md` defines the site title (via frontmatter) and the top-level navigation sections (via Markdown links). Each link slug maps to a subdirectory in `pages/`.

```markdown
---
title: My Docs
---

[Getting Started](getting-started)
[API Reference](api-reference)
```

Link order = nav order.

## `footer.md` — site footer

Optional. Create `pages/footer.md` and its content will appear at the bottom of every page. Supports Markdown — links, copyright notices, etc.

```markdown
© 2026 My Company. [Privacy Policy](https://example.com/privacy)
```

## Page frontmatter

Each page can declare a title via frontmatter. It is used in the sidebar, browser `<title>`, and Pagefind search index.

```yaml
---
title: Page Title
---
```

## Theming

Leafdocs uses Tailwind CSS v4. Override the design tokens in your CSS file to match your brand:

```css
@import "tailwindcss";

@theme {
  --color-primary: #6366f1;   /* accent color */
  --font-sans: 'Your Font', sans-serif;
}
```

All colors, spacing, and typography are driven by these tokens — no magic strings.

## License

MIT
