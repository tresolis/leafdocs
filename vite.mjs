import {defineConfig} from 'vite'
import {dirname, join, resolve} from 'path'
import {fileURLToPath} from 'url'
import {execSync} from 'child_process'
import {copyFileSync, existsSync, mkdirSync, readdirSync, rmSync} from 'fs'
import {createIndex} from 'pagefind'

const __dirname = dirname(fileURLToPath(import.meta.url))
const GENERATOR = join(__dirname, 'cli.mjs')

function collectHtmlInputs(dir, base = dir) {
  const inputs = {}
  if (!existsSync(dir)) return inputs
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) Object.assign(inputs, collectHtmlInputs(full, base))
    else if (entry.name.endsWith('.html')) {
      const key = full.slice(base.length + 1).replace(/\\/g, '/').replace(/\.html$/, '')
      inputs[key] = full
    }
  }
  return inputs
}

function runGenerator(distDir, docsDir) {
  execSync(`node "${GENERATOR}" --root "${docsDir}" --out "${distDir}"`, { stdio: 'inherit' })
}

async function runPagefind(distDir) {
  const { index, errors } = await createIndex({})
  if (errors.length) { console.error('[pagefind]', errors); return }
  await index.addDirectory({ path: distDir })
  const { errors: writeErrors } = await index.writeFiles({ outputPath: join(distDir, 'pagefind') })
  if (writeErrors.length) console.error('[pagefind]', writeErrors)
  else console.log('  [pagefind] index written → dist/pagefind/')
}

function copyDir(src, dest) {
  mkdirSync(dest, { recursive: true })
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const s = join(src, entry.name), d = join(dest, entry.name)
    entry.isDirectory() ? copyDir(s, d) : copyFileSync(s, d)
  }
}

export default function leafdocs({ plugins: userPlugins = [], server: userServer = {}, build: userBuild = {}, ...rest } = {}) {
  const docsDir    = process.cwd()
  const distDir    = join(docsDir, '.docs-generated')
  const distProd   = process.env.DOCS_OUT_DIR ? resolve(process.env.DOCS_OUT_DIR) : join(docsDir, 'dist')
  const pagesDir   = join(docsDir, 'pages')
  const cssDir     = join(docsDir, 'css')
  const openapiDir = join(docsDir, 'openapi')

  mkdirSync(distProd, { recursive: true })

  async function rebuild() {
    rmSync(distDir, { recursive: true, force: true })
    runGenerator(distDir, docsDir)
    await runPagefind(distDir)
  }

  const leafdocsPlugin = {
    name: 'leafdocs',

    options(opts) {
      opts.input = collectHtmlInputs(distDir)
      return opts
    },

    transform(code, id) {
      if (id.startsWith(join(distDir, 'pagefind')) && code.includes('import(')) {
        return { code: code.replaceAll('import(`', 'import(/* @vite-ignore */ `'), map: null }
      }
    },

    configureServer(server) {
      server.watcher.add(pagesDir)
      server.watcher.add(cssDir)
      if (existsSync(openapiDir)) server.watcher.add(openapiDir)

      const isDoc = (f) => {
        const n = f.replace(/\\/g, '/')
        return (n.startsWith(pagesDir.replace(/\\/g, '/')) && /\.(md|html)$/.test(n)) ||
               (n.startsWith(openapiDir.replace(/\\/g, '/')) && /\.(ya?ml|json)$/.test(n))
      }

      const triggerRebuild = async () => { await rebuild(); server.hot.send({ type: 'full-reload' }) }
      server.watcher.on('add',   (file) => { if (isDoc(file)) triggerRebuild() })
      server.watcher.on('unlink', (file) => { if (isDoc(file)) triggerRebuild() })
    },

    closeBundle() {
      const src = join(distDir, 'pagefind')
      if (!existsSync(src)) return
      const dest = join(distProd, 'pagefind')
      mkdirSync(dest, { recursive: true })
      const VITE_BUNDLED = new Set(['pagefind-component-ui.js', 'pagefind-component-ui.css'])
      for (const entry of readdirSync(src, { withFileTypes: true })) {
        if (VITE_BUNDLED.has(entry.name)) continue
        const s = join(src, entry.name), d = join(dest, entry.name)
        entry.isDirectory() ? copyDir(s, d) : copyFileSync(s, d)
      }
      console.log('[leafdocs] pagefind data copied → dist/pagefind/')

      const openapiSrc = join(distDir, 'openapi')
      if (existsSync(openapiSrc)) {
        copyDir(openapiSrc, join(distProd, 'openapi'))
        console.log('[leafdocs] openapi specs copied → dist/openapi/')
      }
    },

    async handleHotUpdate({ file, server }) {
      const f  = file.replace(/\\/g, '/')
      const pd = pagesDir.replace(/\\/g, '/')
      const cd = cssDir.replace(/\\/g, '/')
      const od = openapiDir.replace(/\\/g, '/')

      if ((f.startsWith(pd) && /\.(md|html)$/.test(f)) ||
          (f.startsWith(od) && /\.(ya?ml|json)$/.test(f))) {
        await rebuild()
        server.hot.send({ type: 'full-reload' })
        return []
      }

      if (f.startsWith(cd) && f.endsWith('.css')) {
        copyFileSync(file, join(distDir, 'css', f.slice(cd.length + 1)))
        server.hot.send({ type: 'full-reload' })
        return []
      }
    },
  }

  return defineConfig(async () => {
    await rebuild()
    return {
      root: distDir,
      base: '/',
      plugins: [...userPlugins, leafdocsPlugin],
      server: { port: 3000, open: true, watch: { ignored: (f) => f.startsWith(distDir) }, ...userServer },
      build: {
        outDir: distProd,
        emptyOutDir: true,
        rollupOptions: {
          output: {
            entryFileNames: 'assets/bundle-[hash].js',
            chunkFileNames: 'assets/bundle-[hash].js',
            assetFileNames: ({ name }) =>
              name?.endsWith('.css') ? 'assets/bundle-[hash].[ext]' : 'assets/[name]-[hash].[ext]',
          },
        },
        ...userBuild,
      },
      ...rest,
    }
  })
}
