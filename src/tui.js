// Interactive CLI drift coach — summary screen, browse, fix menu.

import fs from 'node:fs';
import { spawn } from 'node:child_process';
import readline from 'node:readline';

import { parseSource } from './parse.js';
import { computeFixPlan, applyPlan, hasApplicableEdits, driftKey } from './fixer.js';
import { loadConfig, saveConfig, resetScanState } from './config.js';
import { analyzeAllPages } from './pipeline.js';
import { isDemoMode } from './demo-mode.js';
import {
  computeDriftScore, groupDrifts, planForDrift,
  webDeepLink, deepLinkCmd,
} from './interactive.js';
import { driftTypeLabel } from './drift-format.js';
import {
  applySnapshotToTui, subscribeWebEvents, webPost, webHardScan,
} from './web-client.js';

const C = { dim: '\x1b[2m', reset: '\x1b[0m', bold: '\x1b[1m', inv: '\x1b[7m', cyan: '\x1b[36m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', key: '\x1b[97m' };
const SEVC = { high: '\x1b[38;5;203m', medium: '\x1b[38;5;215m', low: '\x1b[38;5;75m' };
const RANK = { high: 3, medium: 2, low: 1 };
const DEL = '\x1b[48;5;52m\x1b[38;5;217m';
const ADD = '\x1b[48;5;22m\x1b[38;5;157m';
const SYN = {
  comment: '\x1b[38;5;102m', string: '\x1b[38;5;151m', color: '\x1b[38;5;183m', number: '\x1b[38;5;173m',
  selector: '\x1b[38;5;179m', property: '\x1b[38;5;111m', value: '\x1b[38;5;151m', punct: '\x1b[38;5;103m', plain: '\x1b[38;5;245m',
};

const TOKEN_RULES = [
  ['comment', /^\/\*[\s\S]*?\*\/|^\/\/.*/],
  ['string', new RegExp('^"[^"]*"|^\'[^\']*\'|^`[^`]*`')],
  ['color', /^#[0-9a-fA-F]{3,8}\b/], ['number', /^-?\d*\.?\d+(?:px|rem|em|%|deg|s|ms)?\b/],
  ['selector', /^::?[A-Za-z-][\w-]*/], ['property', /^-{0,2}[A-Za-z][\w-]*(?=\s*:)/],
  ['punct', /^[{}()<>;:,/=]/], ['value', /^[A-Za-z_][\w-]*/], ['space', /^\s+/],
];

const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

function visLen(s) { return strip(s).length; }

function padVisible(s, w) {
  const v = visLen(s);
  if (v >= w) return clip(s, w);
  return s + ' '.repeat(w - v);
}

function clip(s, width) {
  let out = '', vis = 0, i = 0;
  while (i < s.length && vis < width) {
    if (s[i] === '\x1b') { const m = /^\x1b\[[0-9;]*m/.exec(s.slice(i)); if (m) { out += m[0]; i += m[0].length; continue; } }
    out += s[i]; vis++; i++;
  }
  return out + C.reset;
}

const wrap = (s, w) => {
  const out = []; let line = '';
  for (const word of String(s).split(/\s+/)) {
    if ((line + ' ' + word).trim().length > w) { out.push(line.trim()); line = word; }
    else line += (line ? ' ' : '') + word;
  }
  if (line.trim()) out.push(line.trim());
  return out;
};

function tokenizeLine(line) {
  const out = []; let s = line;
  while (s.length) {
    let hit = false;
    for (const [c, re] of TOKEN_RULES) {
      const m = re.exec(s);
      if (m) { out.push({ c, t: m[0] }); s = s.slice(m[0].length); hit = true; break; }
    }
    if (!hit) { out.push({ c: 'plain', t: s[0] }); s = s.slice(1); }
  }
  return out;
}

function ansiSyntax(text, maxLen) {
  if (maxLen <= 0) return '';
  let out = '', vis = 0;
  for (const tk of tokenizeLine(String(text).replace(/\t/g, '  '))) {
    if (vis >= maxLen) break;
    const piece = tk.t.slice(0, maxLen - vis);
    out += (SYN[tk.c] || SYN.plain) + piece + C.reset;
    vis += piece.length;
  }
  return out;
}

function shortcutHint(pairs) {
  return pairs.map(([k, fn]) => `${C.key}${k}${C.reset} ${C.dim}${fn}${C.reset}`).join('   ');
}

function labeledBlock(label, text, width) {
  const lines = wrap(text, Math.max(10, width - 5));
  return lines.map((ln, i) => (i === 0 ? `${C.dim}${label}${C.reset}  ${ln}` : `     ${ln}`));
}

function colorSwatch(hex) {
  if (!hex || !/^#/.test(hex)) return hex;
  return `\x1b[48;2;${parseInt(hex.slice(1, 3), 16)};${parseInt(hex.slice(3, 5), 16)};${parseInt(hex.slice(5, 7), 16)}m  \x1b[0m ${hex}`;
}

function tokenGlyph(t) {
  if (t.type === 'color' && t.color) return colorSwatch(t.color);
  if (t.type === 'typography') return `${C.dim}Aa${C.reset}`;
  return `${C.dim}${t.px ?? '·'}px${C.reset}`;
}

function buildTokenView(tokens, pageDrifts, curDrift, width, height, scrollTop) {
  const problemNames = new Set(pageDrifts.map((d) => d.token?.name).filter(Boolean));
  const activeName = curDrift?.token?.name;
  const groups = [
    { label: 'colors', items: tokens.filter((t) => t.type === 'color') },
    { label: 'typography', items: tokens.filter((t) => t.type === 'typography') },
    { label: 'spacing & radius', items: tokens.filter((t) => t.type === 'spacing') },
  ];
  const lines = [
    `${C.bold}Code tokens${C.reset} ${C.dim}· found in source · dim = no drift${C.reset}`,
    `${C.dim}{${C.reset}`,
  ];
  for (const g of groups) {
    lines.push(`${C.dim}// ${g.label}${C.reset}`);
    for (const t of g.items) {
      const problem = problemNames.has(t.name);
      const on = t.name === activeName;
      const val = t.label || t.value;
      let body = `${tokenGlyph(t)} "${t.name}": "${val}"`;
      if (on && problem) body = `${C.inv}${body}${C.reset}`;
      else if (problem) body = `${C.bold}${body}${C.reset}`;
      else body = `${C.dim}${body}${C.reset}`;
      lines.push(body);
    }
  }
  lines.push(`${C.dim}}${C.reset}`);
  lines.push(`${C.dim}${tokens.length} tokens · ${problemNames.size} with drift on page${C.reset}`);

  const panelRows = Math.max(1, height - 1);
  const maxTop = Math.max(1, lines.length - panelRows + 1);
  const top = scrollTop == null ? 1 : Math.min(Math.max(1, scrollTop), maxTop);
  const rows = [];
  for (let i = 0; i < panelRows && top - 1 + i < lines.length; i++) {
    rows.push(padVisible(lines[top - 1 + i], width));
  }
  while (rows.length < panelRows) rows.push(' '.repeat(width));
  const end = Math.min(lines.length, top + panelRows - 1);
  rows.push(padVisible(`${C.dim}code tokens  ${top}-${end}/${lines.length}${C.reset}`, width));
  return { rows, scrollTop: top, maxTop, codeRows: panelRows };
}

function renderComparison(d) {
  if (!d) return [];
  if (d.category === 'off-palette' || d.category === 'off-scale') {
    return [
      `${C.dim}${driftTypeLabel(d)}${C.reset}`,
      `${C.dim}found${C.reset}   ${d.actualValues.join(', ')}`,
      '',
    ];
  }
  const expected = d.type === 'typography' && d.token?.label ? d.token.label : d.expected;
  if (expected == null) return [];
  const lines = [`${C.dim}${driftTypeLabel(d)}${C.reset}`];
  if (d.type === 'color') {
    lines.push(`${C.dim}expected${C.reset} ${colorSwatch(expected)}`);
    d.actualValues.forEach((v) => lines.push(`${C.dim}found${C.reset}     ${colorSwatch(v)}`));
  } else {
    lines.push(`${C.dim}expected${C.reset} ${expected}`);
    d.actualValues.forEach((v) => lines.push(`${C.dim}found${C.reset}     ${v}`));
  }
  lines.push('');
  return lines;
}

/** Fresh drift metadata for one render — never reuse across navigation. */
function driftContext(page, curDrift, pageDrifts) {
  const lineSev = {};
  for (const d of pageDrifts) {
    for (const loc of d.locations) {
      if (!lineSev[loc.line] || RANK[d.severity] > RANK[lineSev[loc.line]]) lineSev[loc.line] = d.severity;
    }
  }
  const activeLines = new Set(curDrift ? curDrift.locations.map((l) => l.line) : []);
  const fixAfter = new Map();
  if (curDrift) {
    for (const item of computeFixPlan(page.text, [curDrift])) {
      for (const e of item.edits) fixAfter.set(e.line, e.after);
    }
  }
  const focusLine = activeLines.size ? Math.min(...activeLines) : 1;
  return { lineSev, activeLines, fixAfter, focusLine };
}

function buildCodeView(page, curDrift, pageDrifts, width, height, scrollTop, overrides = {}) {
  const src = page.text.split('\n');
  const total = src.length;
  const codeRows = Math.max(1, height - 1);
  const { lineSev, activeLines, fixAfter, focusLine } = driftContext(page, curDrift, pageDrifts);

  const maxTop = Math.max(1, total - codeRows + 1);
  const top = scrollTop == null
    ? Math.min(Math.max(1, focusLine - Math.floor(codeRows / 2)), maxTop)
    : Math.min(Math.max(1, scrollTop), maxTop);

  const bodyW = Math.max(8, width - 9);
  const rows = [];
  let lineNo = top;

  while (rows.length < codeRows && lineNo <= total) {
    const raw = src[lineNo - 1] ?? '';
    const num = String(lineNo).padStart(4);
    const isActive = activeLines.has(lineNo);
    let after = fixAfter.get(lineNo);
    if (overrides[lineNo] != null) after = overrides[lineNo];

    if (isActive && after != null) {
      rows.push(padVisible(`${DEL}${num} - ${ansiSyntax(raw, bodyW)}${C.reset}`, width));
      if (rows.length < codeRows) {
        rows.push(padVisible(`${ADD}     + ${ansiSyntax(after, bodyW)}${C.reset}`, width));
      }
    } else if (isActive) {
      rows.push(padVisible(`${DEL}${num} > ${ansiSyntax(raw, bodyW)}${C.reset}`, width));
    } else {
      const dot = lineSev[lineNo] ? `${SEVC[lineSev[lineNo]]}*${C.reset}` : ' ';
      const numCol = `${C.dim}${num}${C.reset}`;
      rows.push(padVisible(`${numCol} ${dot} ${ansiSyntax(raw, bodyW)}`, width));
    }
    lineNo++;
  }

  while (rows.length < codeRows) rows.push(' '.repeat(width));

  const shown = Math.min(total, lineNo - 1);
  rows.push(padVisible(`${C.dim}${page.file}  ${top}-${shown}/${total}${C.reset}`, width));
  return { rows, scrollTop: top, maxTop, codeRows };
}

async function scan(pages, cfg) {
  const { pages: results } = await analyzeAllPages({ pages, cfg });
  return problemsFromResults(pages, results);
}

function problemsFromResults(pages, results) {
  const problems = [];
  for (const p of pages) {
    const r = results.find((x) => x.id === p.id);
    if (!r) continue;
    for (const d of r.drifts ?? []) problems.push({ page: p, drift: d });
  }
  return problems;
}

function countSev(problems) {
  const c = { high: 0, medium: 0, low: 0 };
  for (const p of problems) c[p.drift.severity]++;
  return c;
}

function agentPrompt(page, d) {
  const where = d.locations.map((l) => `  - ${l.file}:${l.line}  ${l.selector}  (${l.raw})`).join('\n');
  return `Fix this design-token drift in ${page.file}.\n\nType: ${d.type} (${d.category})\nExpected: ${d.expected ?? 'n/a'}\nFound: ${d.actualValues.join(', ')}\nElement: ${d.elementName || d.locations[0]?.elementName || 'n/a'}\nLocations:\n${where}\n\nProblem: ${d.problem || d.why || ''}\nSolution: ${d.solution || d.fix || ''}`;
}

function copyToClipboard(text) {
  const cmd = process.platform === 'win32' ? 'clip' : process.platform === 'darwin' ? 'pbcopy' : 'xclip';
  try { const c = spawn(cmd, process.platform === 'linux' ? ['-selection', 'clipboard'] : []); c.stdin.write(text); c.stdin.end(); return true; }
  catch { return false; }
}

export async function runTui({
  pages: initialPages,
  pageResults,
  problems: initialProblems,
  tokens: initialTokens,
  diffTokens,
  tokenMode: initialTokenMode = 'intrinsic',
  agent = 'your agent',
  apiKey = null,
  demoMode = false,
  webSync = null,
}) {
  const cfg = loadConfig();
  let pages = initialPages;
  let tokens = initialTokens ?? [];
  let tokenMode = initialTokenMode;
  let problems;
  try {
    if (initialProblems) problems = initialProblems;
    else if (pageResults) problems = problemsFromResults(pages, pageResults);
    else problems = await scan(pages, cfg);
  } catch (e) {
    process.stdout.write('\x1b[?25h\n');
    throw e;
  }

  let idx = 0, curPage = 0, view = 'browse', menu = 0, note = '';
  let codeScroll = null;
  let scrollMeta = { scrollTop: 1, maxTop: 1, codeRows: 16 };
  let viewH = 16;
  let groupMode = false;
  let heatmapOn = false;
  let showTokens = false;
  let showHelp = false;
  let searchQ = '';
  let inlineOverrides = {};
  let lastDriftCount = problems.length;
  let history = [];
  let historyId = 0;
  let tokenScroll = null;
  let unsubWeb = null;

  function mergeSnapshot(snap) {
    const next = applySnapshotToTui(snap, webSync?.sources || pages, { pages, problems, curPage, idx });
    pages = next.pages;
    problems = next.problems;
    tokens = next.tokens;
    tokenMode = next.tokenMode;
    curPage = next.curPage;
    idx = next.idx;
    lastDriftCount = problems.length;
  }

  if (webSync) {
    unsubWeb = subscribeWebEvents(webSync.port, (snap) => {
      mergeSnapshot(snap);
      render();
    });
  }

  const pushHist = (action, detail) => {
    historyId += 1;
    history.unshift({ id: historyId, action, ...detail });
    if (history.length > 12) history.length = 12;
  };

  const scoreInfo = () => {
    const pseudoPages = pages.map((p) => ({ drifts: listFor(p).map((x) => x.drift) }));
    return computeDriftScore(pseudoPages, tokens);
  };

  const modeLabel = webSync
    ? 'web sync'
    : demoMode || isDemoMode(cfg)
      ? 'demo snapshot'
      : (apiKey || cfg.azureOpenAiKey) ? 'AI live' : tokenMode === 'figma' ? 'figma baseline' : 'code scan';

  const COLS = () => process.stdout.columns || 100;
  const pageAt = () => pages[Math.min(curPage, pages.length - 1)];
  const listFor = (pg) => problems.filter((pp) => pp.page === pg);

  function itemsForPage(pg) {
    let items = listFor(pg);
    if (searchQ.trim()) {
      const q = searchQ.toLowerCase();
      items = items.filter(({ drift: d }) =>
        d.token?.name?.toLowerCase().includes(q) || d.category?.includes(q)
        || d.locations?.some((l) => l.selector?.toLowerCase().includes(q)));
    }
    if (groupMode) {
      const drifts = items.map((x) => x.drift);
      return groupDrifts(drifts, 'token').map((g) => ({ page: pg, drift: g.drifts[0], group: g }));
    }
    return items;
  }

  function renderHeatmapSummary(pg) {
    if (!heatmapOn) return [];
    const items = listFor(pg);
    return [`${C.dim}map${C.reset}  ${items.length} markers on page`];
  }

  function resetCodeScroll() { codeScroll = null; tokenScroll = null; }

  function printDeepLink(pg, i) {
    return `${C.dim}link${C.reset}  ${deepLinkCmd({ pageId: pg.id, driftIdx: i })}  ·  ${webDeepLink({ pageId: pg.id, driftIdx: i })}`;
  }

  function render() {
    const cols = COLS(), leftW = Math.min(46, Math.floor(cols * 0.44)), rightW = Math.max(20, cols - leftW - 4);
    const pg = pageAt();
    const items = itemsForPage(pg);
    const N = items.length;
    if (idx >= N) idx = Math.max(0, N - 1);
    const P = N ? items[idx] : null;
    const d = P?.drift;
    let L = [], R = [];

    if (showHelp) {
      L = [`${C.bold}Shortcuts${C.reset}`, 'h close', 't tokens', 'g group', 'm map', '/ search', ...(webSync ? ['r rescan'] : []), ...(!demoMode && !isDemoMode(cfg) ? ['H hard rescan'] : [])];
      R = [`${C.bold}More${C.reset}`, '↑↓ cycle', '←→ page', 'pgup/down scroll', 'a apply-all', 'c agent', 'x dismiss', 'e edit line', 'esc quit'];
      viewH = Math.max(8, (process.stdout.rows || 30) - 6);
      while (L.length < viewH) L.push('');
      while (R.length < viewH) R.push('');
    } else if (!P) {
      L = [`${C.green}No problems on this page.${C.reset}`, '', `${C.dim}${pg.file} looks consistent.${C.reset}`];
    } else {
      const groupLbl = P.group ? ` · group ${P.group.label} (${P.group.ids.length})` : '';
      L.push(`${C.bold}Problem ${idx + 1} / ${N}${groupLbl}${C.reset}`);
      L.push(`${SEVC[d.severity]}${C.bold}${d.severity.toUpperCase()}${C.reset} · ${d.category}`);
      L.push(`${C.dim}${d.type}${d.token ? ' · ' + d.token.name : ''}${C.reset}`);
      L.push('');
      L.push(...renderComparison(d));
      if (d.problem || d.why) L.push(...labeledBlock('problem', d.problem || d.why, leftW));
      if (d.solution || d.fix) L.push(...labeledBlock('solution', d.solution || d.fix, leftW));
      if (d.elementName) L.push(...labeledBlock('element', d.elementName, leftW));
      L.push('');
      L.push(printDeepLink(pg, idx));
      if (history.length) L.push(`${C.dim}hist${C.reset}  ${history[0].action} · ${history[0].pageName || pg.file}`);
    }

    if (!showHelp) {
      L.push(...renderHeatmapSummary(pg));
      viewH = Math.max(8, (process.stdout.rows || 30) - 6);

      if (view === 'menu' && d) {
        const groupN = P.group?.ids?.length ?? 1;
        const curPlan = planForDrift(pg.text, d);
        const canApply = hasApplicableEdits(curPlan);
        const pagePlan = computeFixPlan(pg.text, listFor(pg).map((x) => x.drift));
        const groupApplicable = P.group?.ids?.filter((id) => hasApplicableEdits(pagePlan.find((p) => p.id === id))).length ?? 0;
        const applyAllN = pagePlan.filter(hasApplicableEdits).length;
        const menuItems = [
          { label: `Apply this solution${canApply ? '' : ' (advisory)'}`, enabled: canApply },
          groupN > 1 ? { label: `Fix group (${groupApplicable || groupN})`, enabled: groupApplicable > 0 } : null,
          { label: `Apply all fixes on ${pg.file} (${applyAllN})`, enabled: applyAllN > 0 },
          { label: `Ask ${agent} (copy prompt)`, enabled: true },
        ].filter(Boolean);
        R = ['', `${C.bold}Fix mode${C.reset}`, ''];
        menuItems.forEach((it, i) => {
          const text = it.enabled ? it.label : `${C.dim}${it.label}${C.reset}`;
          R.push(i === menu ? `${C.inv} ${text} ${C.reset}` : `   ${text}`);
        });
        R.push('', shortcutHint([['up/down', 'move'], ['enter', 'select'], ['esc', 'back']]));
        while (R.length < viewH) R.push('');
      } else {
        const pageDrifts = listFor(pg).map((x) => x.drift);
        const pane = showTokens
          ? buildTokenView(tokens, pageDrifts, d ?? null, rightW, viewH, tokenScroll)
          : buildCodeView(pg, d ?? null, pageDrifts, rightW, viewH, codeScroll, inlineOverrides);
        scrollMeta = pane;
        if (showTokens) tokenScroll = pane.scrollTop;
        R = pane.rows;
      }
    }

    const sev = countSev(problems);
    const score = scoreInfo();
    let tabs = '', used = 0;
    for (let i = 0; i < pages.length; i++) {
      const lbl = ` ${pages[i].name} ${listFor(pages[i]).length} `;
      if (used + lbl.length > cols - 1) break;
      tabs += i === curPage ? `${C.inv}${lbl}${C.reset}` : `${C.dim}${lbl}${C.reset}`;
      used += lbl.length;
    }

    const rows = viewH;
    const W = cols;
    let buf = `\x1b[2J\x1b[H`;
    buf += clip(`${C.cyan}${C.bold}Penny${C.reset} ${C.dim}· ${problems.length} drifts · ${score.score}% aligned · ${sev.high}h ${sev.medium}m ${sev.low}l · ${modeLabel}${C.reset}`, W - 1) + '\n';
    buf += clip(tabs, W - 1) + '\n\n';

    for (let i = 0; i < rows; i++) {
      const left = padVisible(L[i] || '', leftW);
      const right = padVisible(R[i] || '', rightW);
      buf += padVisible(`${left} ${C.dim}|${C.reset} ${right}`, W - 1) + '\n';
    }

    const shortcuts = showHelp ? shortcutHint([['h', 'close help']]) : view === 'menu' ? '' : shortcutHint([
      ['up/down', 'cycle'], ['left/right', 'page'], ['pgup/down', 'scroll'], ['enter', 'fix menu'],
      ['t', 'tokens'], ['g', 'group'], ...(webSync ? [['r', 'rescan']] : []), ...(!demoMode && !isDemoMode(cfg) ? [['H', 'hard rescan']] : []), ['h', 'help'], ['esc', 'quit'],
    ]);
    buf += clip(`${note ? C.green + note + C.reset + '  ' : ''}${shortcuts}`, W - 1);
    process.stdout.write(buf);
  }

  async function applyIds(page, ids, overrides = {}) {
    const before = problems.length;
    if (webSync) {
      note = 'Applying…';
      render();
      try {
        const snap = await webPost(webSync.port, '/api/fix', { pageId: page.id, ids, overrides });
        mergeSnapshot(snap);
        const delta = before - problems.length;
        pushHist('fix', { pageName: page.file, ids: ids || [] });
        note = delta > 0 ? `Applied — ${delta} drift${delta !== 1 ? 's' : ''} cleared.` : 'Applied.';
      } catch (e) {
        note = `Fix failed: ${e.message}`;
      }
      resetCodeScroll();
      inlineOverrides = {};
      return;
    }
    let plan = computeFixPlan(page.text, problems.filter((p) => p.page === page).map((p) => p.drift));
    if (Object.keys(overrides).length) {
      plan = plan.map((item) => ({
        ...item,
        edits: item.edits.map((e) => (overrides[e.line] != null ? { ...e, override: overrides[e.line], after: overrides[e.line] } : e)),
      }));
    }
    page.text = applyPlan(page.text, plan, ids);
    fs.writeFileSync(page.path, page.text);
    note = 'Rescanning…';
    resetCodeScroll();
    inlineOverrides = {};
    render();
    problems = await scan(pages, cfg);
    const delta = before - problems.length;
    pushHist('fix', { pageName: page.file, ids: ids || plan.map((p) => p.id) });
    if (delta > 0) note = `Applied — ${delta} drift${delta !== 1 ? 's' : ''} cleared.`;
    else note = 'Applied.';
    lastDriftCount = problems.length;
    if (itemsForPage(page).length > 0 && idx < itemsForPage(page).length - 1) idx = Math.min(idx + 1, itemsForPage(page).length - 1);
    resetCodeScroll();
  }

  async function hardRescanAll() {
    note = 'Hard rescan — clearing memory and rerunning AI…';
    render();
    try {
      if (webSync) {
        const snap = await webHardScan(webSync.port);
        mergeSnapshot(snap);
      } else {
        resetScanState();
        problems = await scan(pages, loadConfig());
        pages = pages.map((p) => {
          const text = fs.readFileSync(p.path, 'utf8');
          return { ...p, text, src: text };
        });
      }
      history = [];
      idx = 0;
      curPage = 0;
      resetCodeScroll();
      note = `${problems.length} drift${problems.length !== 1 ? 's' : ''} after hard rescan.`;
    } catch (e) {
      note = `Hard rescan failed: ${e.message}`;
    }
  }

  function scrollPage(delta) {
    const step = Math.max(1, Math.floor(scrollMeta.codeRows * 0.85));
    const base = (showTokens ? tokenScroll : codeScroll) ?? scrollMeta.scrollTop;
    const next = Math.min(scrollMeta.maxTop, Math.max(1, base + delta * step));
    if (showTokens) tokenScroll = next;
    else codeScroll = next;
  }

  return new Promise((resolve) => {
    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdout.write('\x1b[2J\x1b[?25l');

    const quit = () => {
      unsubWeb?.();
      process.stdout.write('\x1b[?25h\n');
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
      process.stdin.removeListener('keypress', onKey);
      process.stdin.pause();
      resolve();
      process.exit(0);
    };

    async function onKey(ch, key) {
      if (!key) return;
      note = '';
      const pg = pageAt();
      const items = itemsForPage(pg);
      if (idx >= items.length) idx = Math.max(0, items.length - 1);
      const P = items[idx] || null;

      if (key.ctrl && key.name === 'c') return quit();

      if (showHelp && (key.name === 'h' || key.name === 'escape')) { showHelp = false; render(); return; }

      const isPageUp = key.name === 'pageup' || (key.name === 'p' && key.ctrl);
      const isPageDown = key.name === 'pagedown' || (key.name === 'n' && key.ctrl);

      if (view === 'browse') {
        if (key.name === 'q' || key.name === 'escape' || (ch === '\x1b' && !key.name)) return quit();
        if (key.name === 'h') { showHelp = !showHelp; render(); return; }
        if (key.name === 'up') { if (items.length) idx = (idx - 1 + items.length) % items.length; resetCodeScroll(); }
        else if (key.name === 'down') { if (items.length) idx = (idx + 1) % items.length; resetCodeScroll(); }
        else if (key.name === 'left') { curPage = (curPage - 1 + pages.length) % pages.length; idx = 0; resetCodeScroll(); }
        else if (key.name === 'right') { curPage = (curPage + 1) % pages.length; idx = 0; resetCodeScroll(); }
        else if (isPageUp) scrollPage(-1);
        else if (isPageDown) scrollPage(1);
        else if (key.name === 't') { showTokens = !showTokens; resetCodeScroll(); }
        else if (key.name === 'g') { groupMode = !groupMode; idx = 0; resetCodeScroll(); }
        else if (key.name === 'm') heatmapOn = !heatmapOn;
        else if (key.name === 'r' && webSync) {
          note = 'Rescanning…';
          render();
          try {
            const snap = await webPost(webSync.port, '/api/scan', {});
            mergeSnapshot(snap);
            note = `${problems.length} drift${problems.length !== 1 ? 's' : ''} after rescan.`;
          } catch (e) { note = `Rescan failed: ${e.message}`; }
          resetCodeScroll();
        }
        else if ((ch === 'H' || (key.shift && key.name === 'h')) && !demoMode && !isDemoMode(cfg)) {
          await hardRescanAll();
        }
        else if (key.name === 'return' && P) { view = 'menu'; menu = 0; }
        else if (key.name === 'a' && P) { await applyIds(P.page, null); }
        else if (key.name === 'c' && P) {
          const ok = copyToClipboard(agentPrompt(P.page, P.drift));
          note = ok ? 'Prompt copied!' : 'Clipboard unavailable.';
          if (!ok) console.log('\n' + agentPrompt(P.page, P.drift));
        }
        else if (key.name === 'x' && P) {
          if (webSync) {
            note = 'Dismissing…';
            render();
            try {
              const snap = await webPost(webSync.port, '/api/dismiss', { pageId: pg.id, driftId: P.drift.id });
              mergeSnapshot(snap);
              pushHist('dismiss', { pageName: pg.file });
              note = 'Dismissed.';
            } catch (e) { note = `Dismiss failed: ${e.message}`; }
          } else {
            const c = loadConfig(); const set = new Set(c.dismissed || []); set.add(driftKey(P.drift));
            saveConfig({ ...c, dismissed: [...set] });
            problems = await scan(pages, cfg);
            pushHist('dismiss', { pageName: pg.file });
            note = 'Dismissed.';
          }
          resetCodeScroll();
        }
        else if (key.name === '/' && P) {
          note = 'Search: type query then enter (stub — use web / for full search UI)';
        }
      } else {
        const menuCount = P?.group?.ids?.length > 1 ? 4 : 3;
        if (key.name === 'escape' || key.name === 'q') view = 'browse';
        else if (key.name === 'up') menu = (menu + menuCount - 1) % menuCount;
        else if (key.name === 'down') menu = (menu + 1) % menuCount;
        else if (key.name === 'return' && P) {
          const hasGroup = P.group?.ids?.length > 1;
          const pagePlan = computeFixPlan(P.page.text, listFor(P.page).map((x) => x.drift));
          if (menu === 0) {
            if (hasApplicableEdits(planForDrift(P.page.text, P.drift))) await applyIds(P.page, [P.drift.id], inlineOverrides);
            else note = 'No line-level fix for this drift.';
          } else if (hasGroup && menu === 1) {
            const ids = P.group.ids.filter((id) => hasApplicableEdits(pagePlan.find((p) => p.id === id)));
            if (ids.length) await applyIds(P.page, ids, inlineOverrides);
            else note = 'Nothing in group to apply.';
          } else if ((!hasGroup && menu === 1) || (hasGroup && menu === 2)) await applyIds(P.page, null);
          else {
            const ok = copyToClipboard(agentPrompt(P.page, P.drift));
            note = ok ? `Prompt copied — paste into ${agent}.` : 'Clipboard unavailable.';
            if (!ok) console.log('\n' + agentPrompt(P.page, P.drift));
          }
          view = 'browse';
        }
      }
      render();
    }

    process.stdin.on('keypress', onKey);
    render();
  });
}
