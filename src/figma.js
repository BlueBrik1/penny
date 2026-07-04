// Step 1: Figma token pull.
// A thin REST client that builds a Figma "export" object from the live API, plus a
// shared parser that normalizes that export into tokens. Seed data is fed through the
// exact same parser (parseFigmaExport), so offline demo == live path.
//
// Normalized token shape (used by every later stage):
//   { name, type: 'color'|'spacing'|'typography', value, color?, px?, font? }
//     value  - canonical display string ('#ff6b35', '16px', '600 24px/32px Inter')
//     color  - lowercase '#rrggbb' hex (color tokens only)
//     px     - numeric pixels (spacing tokens, and typography font-size)
//     font   - { family, weight, size, lineHeight, letterSpacing } (typography only)

const FIGMA_API = 'https://api.figma.com/v1';

// --- color helpers (shared with css.js via colorToHex export) ----------------

function chan(x) {
  return Math.round(Math.max(0, Math.min(1, x)) * 255);
}

// Figma color {r,g,b,a} floats 0..1 -> canonical string.
export function figmaColorToValue(c, opacity = 1) {
  const a = (c.a ?? 1) * opacity;
  const [r, g, b] = [chan(c.r), chan(c.g), chan(c.b)];
  if (a >= 0.999) {
    return '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('');
  }
  return `rgba(${r}, ${g}, ${b}, ${Number(a.toFixed(3))})`;
}

// Figma style name "brand/primary" -> display path "Brand / Primary"
function styleToNodePath(styleName, nodeName) {
  const fromStyle = styleName.split('/').map((p) => p.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())).join(' / ');
  if (nodeName && nodeName !== styleName && nodeName.includes('/')) {
    return nodeName.split('/').map((p) => p.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())).join(' / ');
  }
  return fromStyle;
}

function withPath(token, styleName, node) {
  const nodeName = node?.name || node?.document?.name;
  return { ...token, nodePath: styleToNodePath(styleName, nodeName) };
}

function parseFillStyle(node, name) {
  const fills = node?.fills || node?.document?.fills;
  const solid = Array.isArray(fills) && fills.find((f) => f.type === 'SOLID' && f.visible !== false);
  if (!solid) return null;
  const value = figmaColorToValue(solid.color, solid.opacity ?? 1);
  return {
    name,
    type: 'color',
    value,
    color: value.startsWith('#') ? value.toLowerCase() : value,
  };
}

function parseTextStyle(node, name) {
  const style = node?.style || node?.document?.style;
  if (!style) return null;
  const size = style.fontSize;
  const lineHeight = style.lineHeightPx ? Math.round(style.lineHeightPx) : null;
  const font = {
    family: style.fontFamily,
    weight: style.fontWeight,
    size,
    lineHeight,
    letterSpacing: style.letterSpacing ?? 0,
  };
  // value is the comparable canonical (font-size px, matching what CSS exposes);
  // label carries the full spec for display.
  const label = `${font.weight} ${size}px${lineHeight ? '/' + lineHeight : ''} ${font.family}`;
  return { name, type: 'typography', value: `${size}px`, px: size, font, label };
}

// Figma Variables API: FLOAT variables become spacing tokens, COLOR become colors.
function parseVariables(variablesResp) {
  const meta = variablesResp?.meta;
  if (!meta?.variables) return [];
  const out = [];
  for (const v of Object.values(meta.variables)) {
    const modes = v.valuesByMode ? Object.values(v.valuesByMode) : [];
    const val = modes[0];
    if (val == null) continue;
    if (v.resolvedType === 'FLOAT' && typeof val === 'number') {
      out.push({ name: v.name, type: 'spacing', value: `${val}px`, px: val, nodePath: styleToNodePath(v.name) });
    } else if (v.resolvedType === 'COLOR' && val && typeof val === 'object' && 'r' in val) {
      const value = figmaColorToValue(val);
      out.push({ name: v.name, type: 'color', value, color: value.startsWith('#') ? value.toLowerCase() : value, nodePath: styleToNodePath(v.name) });
    }
  }
  return out;
}

// Accepts a combined export: { styles, nodes, variables? }.
//   styles    - GET /files/:key/styles response  (meta.styles[])
//   nodes     - GET /files/:key/nodes response    (nodes{ id: {document} })
//   variables - GET /files/:key/variables/local   (optional; enterprise-gated)
export function parseFigmaExport(exp) {
  if (!exp || typeof exp !== 'object') {
    throw new Error('parseFigmaExport: expected an object with { styles, nodes }');
  }
  const tokens = [];
  const styles = exp.styles?.meta?.styles || [];
  const nodesById = exp.nodes?.nodes || {};

  for (const s of styles) {
    const wrapper = nodesById[s.node_id];
    if (!wrapper) continue;
    const node = wrapper.document || wrapper;
    let token = null;
    if (s.style_type === 'FILL') token = parseFillStyle(node, s.name);
    else if (s.style_type === 'TEXT') token = parseTextStyle(node, s.name);
    if (token) tokens.push(withPath(token, s.name, node));
  }

  tokens.push(...parseVariables(exp.variables));
  return tokens;
}

// --- live REST client --------------------------------------------------------

async function figmaGet(path, token, fetchImpl) {
  const res = await fetchImpl(`${FIGMA_API}${path}`, {
    headers: { 'X-Figma-Token': token },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Figma API ${res.status} on ${path}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

// Pulls color/typography styles + (best-effort) spacing variables from a live file.
// Returns normalized tokens via the same parser the seed data uses.
export async function fetchFigmaTokens({ token, fileKey, fetchImpl = globalThis.fetch }) {
  if (!token) throw new Error('FIGMA_TOKEN is required for a live pull');
  if (!fileKey) throw new Error('FIGMA_FILE_KEY is required for a live pull');

  const styles = await figmaGet(`/files/${fileKey}/styles`, token, fetchImpl);
  const styleList = styles?.meta?.styles || [];
  const wantIds = styleList
    .filter((s) => s.style_type === 'FILL' || s.style_type === 'TEXT')
    .map((s) => s.node_id);

  let nodes = { nodes: {} };
  if (wantIds.length) {
    nodes = await figmaGet(`/files/${fileKey}/nodes?ids=${encodeURIComponent(wantIds.join(','))}`, token, fetchImpl);
  }

  // Variables API is enterprise-gated; a 403 there shouldn't fail the whole pull.
  let variables = null;
  try {
    variables = await figmaGet(`/files/${fileKey}/variables/local`, token, fetchImpl);
  } catch {
    variables = null; // ponytail: spacing comes from variables when available, else skipped
  }

  return parseFigmaExport({ styles, nodes, variables });
}

// --- frame geometry: bounding boxes + rendered image (for the web overlay) ----

// Flatten a frame's node tree into frame-relative boxes. Layer `name` doubles as the
// CSS selector to project drift onto (name your Figma layers to match your selectors).
export function flattenFrameNodes(frameDoc) {
  const origin = frameDoc.absoluteBoundingBox || { x: 0, y: 0 };
  const out = [];
  const visit = (node) => {
    const bb = node.absoluteBoundingBox;
    if (bb && node.name && node.id !== frameDoc.id) {
      out.push({
        id: node.id,
        name: node.name,
        selector: node.name, // convention: layer name === CSS selector
        x: Math.round(bb.x - origin.x),
        y: Math.round(bb.y - origin.y),
        w: Math.round(bb.width),
        h: Math.round(bb.height),
      });
    }
    (node.children || []).forEach(visit);
  };
  (frameDoc.children || []).forEach(visit);
  return out;
}

// Live: fetch one frame's geometry (GET /nodes) and a rendered PNG (GET /images).
// Returns the same shape as seed/frame.json (minus the local `image` path — uses imageUrl).
export async function fetchFigmaFrame({ token, fileKey, nodeId, fetchImpl = globalThis.fetch, scale = 2 }) {
  if (!token || !fileKey || !nodeId) throw new Error('fetchFigmaFrame needs token, fileKey, nodeId');
  const nodesResp = await figmaGet(`/files/${fileKey}/nodes?ids=${encodeURIComponent(nodeId)}`, token, fetchImpl);
  const doc = nodesResp?.nodes?.[nodeId]?.document;
  if (!doc) throw new Error(`Frame ${nodeId} not found in file ${fileKey}`);
  const bb = doc.absoluteBoundingBox || { width: 0, height: 0 };

  const imgResp = await figmaGet(`/images/${fileKey}?ids=${encodeURIComponent(nodeId)}&format=png&scale=${scale}`, token, fetchImpl);
  const imageUrl = imgResp?.images?.[nodeId] || null;

  return {
    frame: { id: doc.id, name: doc.name, width: Math.round(bb.width), height: Math.round(bb.height) },
    nodes: flattenFrameNodes(doc),
    imageUrl,
  };
}
