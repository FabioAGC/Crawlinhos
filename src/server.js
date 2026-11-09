#!/usr/bin/env node
/**
 * Servidor do site: arquivos estáticos de dist/, redirecionador de afiliado com
 * contagem de cliques (/go/<id>), API JSON e agendador diário embutido.
 *
 *   node src/server.js                 # só serve
 *   node src/server.js --schedule 06:00  # serve e roda coleta+build todo dia às 06:00 (hora do servidor)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { ROOT, loadEnv, readJSON } = require('./util');

loadEnv();

const DIST = path.join(ROOT, 'dist');
const CLICKS = path.join(ROOT, 'data/clicks.jsonl');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml' };
const ALLOWED_HOSTS = /(^|\.)(amazon\.com\.br|mercadolivre\.com\.br|mercadolivre\.com|shopee\.com\.br|shope\.ee|magazineluiza\.com\.br|magazinevoce\.com\.br)$/;

let links = {};
let linksMtime = 0;
function loadLinks() {
  const f = path.join(ROOT, 'data/links.json');
  try {
    const m = fs.statSync(f).mtimeMs;
    if (m !== linksMtime) {
      links = readJSON(f, {});
      linksMtime = m;
    }
  } catch {}
  return links;
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', ...headers });
  res.end(body);
}

function handleGo(req, res, id) {
  const target = loadLinks()[id];
  let ok = false;
  try {
    const u = new URL(target);
    ok = u.protocol === 'https:' && ALLOWED_HOSTS.test(u.hostname); // nunca vira redirecionador aberto
  } catch {}
  if (!ok) return send(res, 404, 'Oferta não encontrada ou expirada.');
  const rec = { t: new Date().toISOString(), id, ref: req.headers.referer || null, ua: (req.headers['user-agent'] || '').slice(0, 160) };
  fs.appendFile(CLICKS, JSON.stringify(rec) + '\n', () => {});
  res.writeHead(302, { Location: target, 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' });
  res.end();
}

function handleStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(DIST, rel));
  if (!file.startsWith(DIST + path.sep)) return send(res, 403, 'Proibido');
  fs.stat(file, (err, st) => {
    if (!err && st.isDirectory()) {
      res.writeHead(301, { Location: pathname + '/' });
      return res.end();
    }
    if (err) return send(res, 404, 'Página não encontrada');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'public, max-age=300' });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

function clickStats() {
  const by = {};
  let total = 0;
  try {
    for (const line of fs.readFileSync(CLICKS, 'utf8').split('\n')) {
      if (!line) continue;
      const r = JSON.parse(line);
      by[r.id] = (by[r.id] || 0) + 1;
      total++;
    }
  } catch {}
  const top = Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 50).map(([id, clicks]) => ({ id, clicks }));
  return { total, top };
}

const server = http.createServer((req, res) => {
  let url;
  try {
    url = new URL(req.url, 'http://localhost');
  } catch {
    return send(res, 400, 'Requisição inválida');
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Método não permitido');
  const p = url.pathname;
  let m;
  try {
    if ((m = p.match(/^\/go\/(.+)$/))) return handleGo(req, res, decodeURIComponent(m[1]));
    if ((m = p.match(/^\/api\/products\/([a-z0-9_-]+)$/))) {
      const data = readJSON(path.join(ROOT, `data/products/${m[1]}.json`), null);
      if (!data) return send(res, 404, '{"error":"nicho não encontrado"}', { 'Content-Type': MIME['.json'] });
      return send(res, 200, JSON.stringify(data), { 'Content-Type': MIME['.json'] });
    }
    if (p === '/api/status')
      return send(res, 200, JSON.stringify(readJSON(path.join(ROOT, 'data/status.json'), {})), { 'Content-Type': MIME['.json'] });
    if (p === '/api/clicks') return send(res, 200, JSON.stringify(clickStats()), { 'Content-Type': MIME['.json'] });
    return handleStatic(req, res, p);
  } catch (e) {
    return send(res, 400, 'Requisição inválida');
  }
});

/** Agendador diário simples (alternativa ao crontab do sistema). */
function schedule(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  let running = false;
  const runDaily = () => {
    if (running) return;
    running = true;
    console.log(`[cron] ${new Date().toISOString()} iniciando coleta diária`);
    const child = spawn(process.execPath, ['-e', "require('./src/pipeline').run().then(()=>require('./src/build').build())"], { cwd: ROOT, stdio: 'inherit' });
    child.on('exit', (code) => {
      running = false;
      console.log(`[cron] coleta terminou (código ${code})`);
    });
  };
  const next = () => {
    const now = new Date();
    const at = new Date(now);
    at.setHours(h, m, 0, 0);
    if (at <= now) at.setDate(at.getDate() + 1);
    setTimeout(() => {
      runDaily();
      next();
    }, at - now);
    console.log(`[cron] próxima coleta: ${at.toString()}`);
  };
  next();
}

if (require.main === module) {
  const port = parseInt(process.env.PORT || '8080', 10);
  server.listen(port, () => console.log(`Radar no ar: http://localhost:${port}`));
  const i = process.argv.indexOf('--schedule');
  if (i > -1) schedule(process.argv[i + 1] || '06:00');
}

module.exports = { server, schedule };
