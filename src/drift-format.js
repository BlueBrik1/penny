// Normalize drift text + display fields for CLI and web.

export function driftTypeLabel(d) {
  if (!d) return '';
  if (d.category === 'off-palette') return 'Off palette';
  if (d.category === 'off-scale') return 'Off scale';
  if (d.type === 'color') return 'Color';
  if (d.type === 'spacing') return 'Spacing';
  if (d.type === 'typography') return 'Typography';
  return d.type || 'Drift';
}

function locList(d) {
  return (d.locations || []).map((l) => `${l.selector} (${l.file}:${l.line})`).join(', ');
}

export function offlineCopy(d) {
  const canonical = d.token?.label || d.expected;
  const name = d.token?.name;
  const where = locList(d);
  const found = d.actualValues?.join(', ') || '';
  switch (d.category) {
    case 'inconsistent-usage':
      return {
        problem: `Token "${name}" should be ${canonical} everywhere but also appears as ${found}.`,
        solution: `Standardize on ${canonical} at ${where}.`,
      };
    case 'value-drift':
      return {
        problem: `${found} does not match the canonical ${name || d.type} value ${canonical}.`,
        solution: `Change ${found} to ${canonical} at ${where}.`,
      };
    case 'off-palette':
    case 'off-scale':
      return {
        problem: `${found} is off-${d.type === 'color' ? 'palette' : 'scale'} — no matching design token.`,
        solution: `Replace ${found} at ${where} with the nearest system token or add a new token.`,
      };
    default:
      return {
        problem: `${found || 'Value'} diverges from the design tokens.`,
        solution: `Reconcile with ${name || 'the nearest token'} at ${where}.`,
      };
  }
}

/** Ensure problem, solution, expected, found, and highlight fields exist. */
export function finalizeDrift(d) {
  if (!d) return d;
  const fallback = offlineCopy(d);
  const problem = (d.problem || d.why || fallback.problem || '').trim();
  const solution = (d.solution || d.fix || fallback.solution || '').trim();
  const expected = d.expected ?? d.token?.value ?? null;
  const found = [...new Set(d.actualValues?.length ? d.actualValues : d.found || [])];

  const locations = (d.locations || []).map((loc) => ({
    ...loc,
    highlight: loc.highlight || loc.selector || loc.raw || null,
    elementName: loc.elementName || loc.selector || 'element',
  }));

  return {
    ...d,
    problem,
    solution,
    why: problem,
    fix: solution,
    expected,
    actualValues: found,
    found,
    locations,
    elementName: d.elementName || locations[0]?.elementName || null,
  };
}

export function hasRequiredDriftFields(d) {
  return !!(d?.problem?.trim() && d?.solution?.trim() && d?.locations?.length);
}
