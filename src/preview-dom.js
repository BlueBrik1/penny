// Safe append helpers for preview iframe documents (may be loading or torn down).

export function appendToHead(doc, node) {
  const mount = doc?.head || doc?.documentElement;
  if (!mount || !node) return false;
  try {
    mount.appendChild(node);
    return true;
  } catch {
    return false;
  }
}

export function appendToBody(doc, node) {
  if (!doc?.body || !node) return false;
  try {
    doc.body.appendChild(node);
    return true;
  } catch {
    return false;
  }
}

export function docReady(doc) {
  return !!(doc?.body || doc?.head || doc?.documentElement);
}
