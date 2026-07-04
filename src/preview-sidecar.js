// Transparent proxy to the user's dev server — paths stay /, only injects penny-bridge for highlights.

import http from 'node:http';
import https from 'node:https';

export function injectBridge(html, bridgeScriptUrl) {
  const tag = `<script src="${bridgeScriptUrl}"></script>`;
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `${tag}</head>`);
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => `${m}${tag}`);
  return `${tag}${html}`;
}

/** Forward to upstream unchanged; inject bridge script into HTML only. */
export function startPreviewSidecar(upstream, bridgeScriptUrl) {
  const target = new URL(upstream);
  const lib = target.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const opts = {
        hostname: target.hostname,
        port: target.port || (target.protocol === 'https:' ? 443 : 80),
        path: req.url,
        method: req.method,
        headers: { ...req.headers, host: target.host },
      };
      delete opts.headers['accept-encoding'];

      const upReq = lib.request(opts, (upRes) => {
        const headers = { ...upRes.headers };
        delete headers['content-security-policy'];
        delete headers['x-frame-options'];
        delete headers['content-length'];

        const type = headers['content-type'] || '';
        if (req.method === 'GET' && type.includes('text/html')) {
          const chunks = [];
          upRes.on('data', (c) => chunks.push(c));
          upRes.on('end', () => {
            const html = injectBridge(Buffer.concat(chunks).toString('utf8'), bridgeScriptUrl);
            res.writeHead(upRes.statusCode || 502, headers);
            res.end(html);
          });
          return;
        }
        res.writeHead(upRes.statusCode || 502, headers);
        upRes.pipe(res);
      });
      upReq.on('error', (e) => {
        res.writeHead(502, { 'Content-Type': 'text/plain' });
        res.end(`Dev server unreachable (${e.message})`);
      });
      req.pipe(upReq);
    });

    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => server.close(),
      });
    });
  });
}
