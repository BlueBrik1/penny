// Preview renderer — detect CSS / Tailwind / React / Vue / etc. and build iframe srcDoc.

export const PREVIEW_KIND = {
  CSS_HTML: 'css+html',
  CSS_ONLY: 'css-only',
  TAILWIND_JSX: 'tailwind-jsx',
  REACT_JSX: 'react-jsx',
  VUE: 'vue',
  SVELTE: 'svelte',
  HTML: 'html',
  MARKUP: 'markup',
};

const TW_CLASS = /\b(?:p|px|py|pt|pr|pb|pl|m|mx|my|mt|mr|mb|ml|gap|text|bg|flex|grid|rounded|border|shadow|space-[xy])-(?:\d|\[)/;
const TW_ARB = /[a-zA-Z][\w-]*-\[[^\]]+\]/;

/** Infer how to render a source file in the preview iframe. */
export function detectPreviewKind(src, srcFile, html = '') {
  const ext = (srcFile.split('.').pop() || '').toLowerCase();
  const hasHtml = !!(html && html.trim());

  if (hasHtml && (ext === 'css' || ext === 'scss' || ext === 'less')) return PREVIEW_KIND.CSS_HTML;
  if (ext === 'html' || ext === 'htm') return PREVIEW_KIND.HTML;
  if (ext === 'vue') return PREVIEW_KIND.VUE;
  if (ext === 'svelte') return PREVIEW_KIND.SVELTE;

  if (ext === 'jsx' || ext === 'tsx') return PREVIEW_KIND.REACT_JSX;

  if (ext === 'css' || ext === 'scss' || ext === 'less') {
    return hasHtml ? PREVIEW_KIND.CSS_HTML : PREVIEW_KIND.CSS_ONLY;
  }

  if (/<[a-zA-Z][\s\S]*>/.test(src)) return PREVIEW_KIND.MARKUP;
  return PREVIEW_KIND.CSS_ONLY;
}

/** Guess companion HTML path: foo.css → foo.html in same directory. */
export function companionHtmlPath(srcPath) {
  if (!srcPath) return null;
  const lower = srcPath.toLowerCase();
  if (/\.(css|scss|less|jsx|tsx|js|ts)$/.test(lower)) {
    return srcPath.replace(/\.(css|scss|less|jsx|tsx|js|ts)$/i, '.html');
  }
  return null;
}

/** Build minimal DOM from CSS class selectors so css-only files still preview. */
export function synthesizeHtmlFromCss(css) {
  const classes = new Set();
  for (const m of css.matchAll(/\.([a-zA-Z_][\w-]*)/g)) {
    const c = m[1];
    if (/^(hover|active|focus|before|after|root|html|body)$/.test(c)) continue;
    if (c.includes(':')) continue;
    classes.add(c);
  }
  const items = [...classes].slice(0, 48);
  if (!items.length) return '<div class="penny-preview"><p>No selectors found in CSS.</p></div>';
  const blocks = items.map((c) => {
    const tag = /^h[1-6]$/.test(c) ? c : /^btn/.test(c) ? 'button' : 'div';
    const label = c.replace(/-/g, ' ');
    return `<${tag} class="${c}">${label}</${tag}>`;
  }).join('\n');
  return `<div class="penny-preview demo-page">${blocks}</div>`;
}

function spotlightCss(selectorList) {
  if (!selectorList.length) return { css: '', overlay: '' };
  const sel = selectorList.filter(Boolean);
  const targets = sel.join(',');
  return {
    css: `.pv-dim{position:fixed;inset:0;background:rgba(17,17,19,0.68);z-index:100;pointer-events:none;}
      ${targets}{position:relative !important;z-index:200 !important;isolation:isolate !important;
        outline:3px solid #fff !important;outline-offset:3px !important;border-radius:6px !important;
        box-shadow:0 0 0 1px rgba(0,0,0,0.15),0 0 0 6px rgba(255,255,255,0.92),0 0 28px 10px rgba(255,255,255,0.55),0 14px 40px rgba(0,0,0,0.35) !important;
        filter:brightness(1.22) saturate(1.08) contrast(1.04) !important;}`,
    overlay: '<div class="pv-dim" aria-hidden="true"></div>',
  };
}

const CSS_BASE = `*{box-sizing:border-box}body{margin:0;padding:20px;background:#f7f8fa;font-family:system-ui,-apple-system,sans-serif;color:#111;line-height:1.5}
button{display:inline-block;border:0;cursor:default;font:inherit;line-height:1.2}
.pv-row,.demo-section{margin:14px 0}.pv-row{display:flex;gap:16px;align-items:center;flex-wrap:wrap}
.swatch-row{gap:10px}.space-grid{display:flex;flex-wrap:wrap;gap:12px}
.pv-cards{display:flex;gap:20px;flex-wrap:wrap;margin-top:12px}
.grid{display:grid;grid-template-columns:repeat(3,1fr)}.grid>div{background:#fff;border:1px solid #e4e7ec;border-radius:8px;height:48px}
.type-ramp,.radius-row{display:flex;flex-wrap:wrap;gap:10px}.margin-stack{display:flex;flex-direction:column}
b,strong{font-weight:700}`;

export function mapSpotSelectors(selectors, tailwind = false) {
  return [...selectors].filter(Boolean).map((s) => {
    if (!tailwind) return s;
    if (s.startsWith('[')) return s;
    if (/^[a-zA-Z][\w-]*-\[/.test(s) || /^[pm][trblxy]?-\d/.test(s) || /^gap-/.test(s) || /^text-/.test(s) || /^bg-/.test(s)) {
      const esc = s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      return `[class*="${esc}"]`;
    }
    if (s.startsWith('.') || s.startsWith('#')) return s;
    return `[class*="${s.replace(/"/g, '')}"]`;
  });
}

/** Pulse animation CSS for apply-fix feedback (selectors mapped for preview kind). */
export function buildPulseCss(selectors, tailwind = false) {
  const mapped = mapSpotSelectors(selectors, tailwind);
  if (!mapped.length) return '';
  return `@keyframes fixPulse{0%,100%{outline-color:#82d69a;filter:brightness(1.12)}50%{outline-color:#4ade80;box-shadow:0 0 20px #82d69a;filter:brightness(1.28)}}
    ${mapped.join(',')}{animation:fixPulse 1.2s ease-out 2 !important;outline:3px solid #82d69a !important;outline-offset:3px !important;position:relative !important;z-index:200 !important;filter:brightness(1.15) !important;}`;
}

export function hasExternalImports(src) {
  return /^import\s+.+from\s+['"]\.\.?\/[^'"]+['"]/m.test(src);
}

/** Resolve iframe target: embed dev server URL or render srcDoc via Babel/CSS. */
export function resolvePreviewTarget({
  src, srcFile, html = '', previewDevServer, previewProxyUrl, previewUrl, previewPath,
}) {
  const kind = detectPreviewKind(src, srcFile, html);
  if (previewUrl) return { kind, previewUrl, mode: 'url' };
  const ext = (srcFile.split('.').pop() || '').toLowerCase();
  const isJsx = ext === 'jsx' || ext === 'tsx';
  const devBase = previewProxyUrl || previewDevServer;
  if (isJsx && devBase) {
    const base = devBase.replace(/\/$/, '');
    const route = previewPath || '/';
    const pathPart = route.startsWith('/') ? route : `/${route}`;
    const url = pathPart === '/' ? `${base}/` : `${base}${pathPart}`;
    return { kind: PREVIEW_KIND.REACT_JSX, previewUrl: url, mode: 'url' };
  }
  if (isJsx && hasExternalImports(src)) {
    return { kind: PREVIEW_KIND.REACT_JSX, previewUrl: null, mode: 'srcdoc', importWarning: true };
  }
  return { kind, previewUrl: null, mode: 'srcdoc' };
}

export function jsxToStaticHtml(src) {
  const start = src.indexOf('<'), end = src.lastIndexOf('>');
  if (start === -1 || end === -1) return '';
  return src.slice(start, end + 1)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\{`([^`]*)`\}/g, '$1')
    .replace(/\bclassName=/g, 'class=')
    .replace(/\{['"]([^'"]*)['"]\}/g, '$1')
    .replace(/\{[^}]+\}/g, '');
}

export function extractExportName(src) {
  let m = src.match(/export\s+default\s+function\s+(\w+)/);
  if (m) return m[1];
  m = src.match(/export\s+function\s+(\w+)/);
  if (m) return m[1];
  m = src.match(/export\s+default\s+(\w+)/);
  return m?.[1] || 'App';
}

function extractVueTemplate(src) {
  const m = src.match(/<template[^>]*>([\s\S]*?)<\/template>/i);
  return m ? m[1].trim() : jsxToStaticHtml(src);
}

function extractSvelteMarkup(src) {
  const end = src.indexOf('<script');
  return end > 0 ? src.slice(0, end).trim() : src.trim();
}

function buildCssDocument(css, bodyHtml, spotSelectors, extraCss) {
  const sel = mapSpotSelectors(spotSelectors, false);
  const { css: spot, overlay } = spotlightCss(sel);
  return `<!doctype html><html><head><meta charset="utf-8"><style>${CSS_BASE}\n${css}\n${extraCss}\n${spot}</style></head><body>${bodyHtml}${overlay}</body></html>`;
}

function buildTailwindDocument(bodyHtml, spotSelectors, extraCss, inlineCss = '') {
  const sel = mapSpotSelectors(spotSelectors, true);
  const { css: spot, overlay } = spotlightCss(sel);
  return `<!doctype html><html><head><meta charset="utf-8"><script src="https://cdn.tailwindcss.com"></script>
<style>body{margin:0;padding:24px;background:#f7f8fa;font-family:system-ui,sans-serif}${inlineCss}${extraCss}${spot}</style></head><body>${bodyHtml}${overlay}</body></html>`;
}

/** Strip ES module syntax so Babel standalone can run React previews. */
export function prepareReactForBabel(src) {
  const hooks = [];
  let out = src.replace(/^import\s+React(?:,\s*\{([^}]+)\})?\s+from\s+['"]react['"];?\s*$/gm, (_, names) => {
    if (names) {
      for (const part of names.split(',')) {
        const [orig, alias] = part.trim().split(/\s+as\s+/);
        hooks.push(`const ${alias || orig} = React.${orig};`);
      }
    }
    return '';
  });
  out = out.replace(/^import\s+\{([^}]+)\}\s+from\s+['"]react['"];?\s*$/gm, (_, names) => {
    for (const part of names.split(',')) {
      const [orig, alias] = part.trim().split(/\s+as\s+/);
      hooks.push(`const ${alias || orig} = React.${orig};`);
    }
    return '';
  });
  out = out.replace(/^import\s+.*?from\s+['"][^'"]+['"];?\s*$/gm, '');
  out = out.replace(/^export\s+default\s+/gm, '');
  out = out.replace(/^export\s+(?=function|const|class)/gm, '');
  return `${hooks.join('\n')}\n${out}`.trim();
}

function buildImportWarningDocument(srcFile, extraCss) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;padding:28px 32px;background:#f7f8fa;font-family:system-ui,sans-serif;color:#1a1a2e;line-height:1.55;max-width:520px}
h2{font-size:18px;margin:0 0 12px} code{background:#e8eaef;padding:2px 6px;border-radius:4px;font-size:13px}
ol{padding-left:20px} li{margin:8px 0}${extraCss}</style></head><body>
<h2>Preview needs your dev server</h2>
<p><code>${srcFile}</code> imports other local files. Penny renders standalone components in-isolation; multi-file React apps need your running dev server.</p>
<ol>
<li>Run <code>npm run dev</code> (or your usual start command)</li>
<li>Add to <code>~/.driftrc</code>: <code>"previewDevServer": "http://localhost:5173"</code></li>
<li>Optionally set <code>previewPath</code> per source (e.g. <code>"/pricing"</code>)</li>
</ol>
</body></html>`;
}

function buildReactDocument(src, spotSelectors, extraCss) {
  const name = extractExportName(src);
  const sel = mapSpotSelectors(spotSelectors, true);
  const { css: spot, overlay } = spotlightCss(sel);
  const body = prepareReactForBabel(src).replace(/<\/script/gi, '<\\/script');
  return `<!doctype html><html><head><meta charset="utf-8">
<script crossorigin src="https://unpkg.com/react@18/umd/react.development.js"></script>
<script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
<script src="https://cdn.tailwindcss.com"></script>
<script src="https://unpkg.com/@babel/standalone@7.25.6/babel.min.js"></script>
<style>body{margin:0;padding:0;background:#f7f8fa}${extraCss}${spot}</style></head>
<body><div id="root"></div>${overlay}
<script type="text/babel" data-presets="react">
${body}
const __pennyRoot = ReactDOM.createRoot(document.getElementById('root'));
const __pennyComp = typeof ${name} !== 'undefined' ? ${name} : () => React.createElement('p', null, 'Preview unavailable');
try { __pennyRoot.render(React.createElement(__pennyComp)); }
catch (e) {
  __pennyRoot.render(React.createElement('div', { style: { padding: 24, fontFamily: 'system-ui', color: '#c00' } },
    React.createElement('strong', null, 'Preview error: '), e.message));
}
</script></body></html>`;
}

/**
 * Build full iframe srcDoc for a page.
 * @param {{ src, srcFile, html?, previewKind?, spotSelectors?, extraCss? }}
 */
export function buildPreviewDocument({
  src,
  srcFile,
  html = '',
  previewKind = null,
  spotSelectors = [],
  extraCss = '',
  previewImportWarning = false,
}) {
  if (previewImportWarning) return buildImportWarningDocument(srcFile, extraCss);
  const kind = previewKind || detectPreviewKind(src, srcFile, html);
  const spot = spotSelectors || [];

  switch (kind) {
    case PREVIEW_KIND.CSS_HTML:
      return buildCssDocument(src, html?.trim() ? html : synthesizeHtmlFromCss(src), spot, extraCss);
    case PREVIEW_KIND.CSS_ONLY:
      return buildCssDocument(src, synthesizeHtmlFromCss(src), spot, extraCss);
    case PREVIEW_KIND.HTML:
      return buildCssDocument('', src, spot, extraCss);
    case PREVIEW_KIND.TAILWIND_JSX:
    case PREVIEW_KIND.REACT_JSX:
      return buildReactDocument(src, spot, extraCss);
    case PREVIEW_KIND.VUE:
      return buildTailwindDocument(extractVueTemplate(src), spot, extraCss);
    case PREVIEW_KIND.SVELTE:
      return buildTailwindDocument(extractSvelteMarkup(src), spot, extraCss);
    case PREVIEW_KIND.MARKUP:
      if (TW_CLASS.test(src) || TW_ARB.test(src)) return buildTailwindDocument(jsxToStaticHtml(src), spot, extraCss);
      return buildCssDocument('', jsxToStaticHtml(src) || src, spot, extraCss);
    default:
      return buildCssDocument(src, html || synthesizeHtmlFromCss(src), spot, extraCss);
  }
}

/** iframe sandbox — scripts needed for Tailwind CDN and React previews. */
export function previewSandbox(previewKind) {
  const needsScripts = [
    PREVIEW_KIND.TAILWIND_JSX,
    PREVIEW_KIND.REACT_JSX,
    PREVIEW_KIND.VUE,
    PREVIEW_KIND.SVELTE,
    PREVIEW_KIND.MARKUP,
  ].includes(previewKind);
  return needsScripts ? 'allow-scripts allow-same-origin' : 'allow-same-origin';
}

/** Human label for UI. */
export function previewKindLabel(kind) {
  const labels = {
    'css+html': 'CSS + HTML',
    'css-only': 'CSS',
    'tailwind-jsx': 'Tailwind',
    'react-jsx': 'React',
    vue: 'Vue',
    svelte: 'Svelte',
    html: 'HTML',
    markup: 'Markup',
  };
  return labels[kind] || kind;
}

/** Legacy lang field for server compatibility. */
export function langFromPreviewKind(kind) {
  return kind === PREVIEW_KIND.CSS_HTML || kind === PREVIEW_KIND.CSS_ONLY ? 'css' : 'markup';
}
