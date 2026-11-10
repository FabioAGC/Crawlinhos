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

// Diretórios sobrescrevíveis por variável de ambiente (usado pelos testes para não sujar data/ real)
const DATA = path.resolve(process.env.RADAR_DATA_DIR || path.join(ROOT, 'data'));
const DIST = path.resolve(process.env.RADAR_DIST_DIR || path.join(ROOT, 'dist'));
const CLICKS = path.join(DATA, 'clicks.jsonl');
const SECURITY = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin' };
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml' };
const ALLOWED_HOSTS = /(^|\.)(amazon\.com\.br|mercadolivre\.com\.br|mercadolivre\.com|shopee\.com\.br|shope\.ee|magazineluiza\.com\.br|magazinevoce\.com\.br)$/;

let links = {};
let linksMtime = 0;
function loadLinks() {
  const f = path.join(DATA, 'links.json');
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
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': Buffer.byteLength(body), ...SECURITY, ...headers });
  res.end(body);
}

function handleGo(req, res, id) {
  const all = loadLinks();
  const target = Object.prototype.hasOwnProperty.call(all, id) ? all[id] : null;
  let ok = false;
  try {
    const u = new URL(target);
    ok = u.protocol === 'https:' && ALLOWED_HOSTS.test(u.hostname); // nunca vira redirecionador aberto
  } catch {}
  if (!ok) return send(res, 404, 'Oferta não encontrada ou expirada.');
  // HEAD (pré-carregamento, verificadores de link) não conta como clique.
  if (req.method === 'GET') {
    const rec = { t: new Date().toISOString(), id, ref: req.headers.referer || null, ua: (req.headers['user-agent'] || '').slice(0, 160) };
    fs.appendFile(CLICKS, JSON.stringify(rec) + '\n', (err) => err && console.error('[go] falha ao gravar clique:', err.message));
  }
  res.writeHead(302, { Location: target, 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', ...SECURITY });
  res.end();
}

function handleStatic(req, res, pathname, search) {
  let rel = decodeURIComponent(pathname);
  // Barra invertida e byte nulo nunca são legítimos aqui (no Windows "\\" é separador de diretório).
  if (rel.includes('\0') || rel.includes('\\')) return send(res, 400, 'Requisição inválida');
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(DIST, rel));
  if (!file.startsWith(DIST + path.sep)) return send(res, 403, 'Proibido');
  // Arquivos ocultos (.env, .git...) não são servidos.
  if (path.relative(DIST, file).split(path.sep).some((seg) => seg.startsWith('.'))) return send(res, 404, 'Página não encontrada');
  fs.stat(file, (err, st) => {
    if (!err && st.isDirectory()) {
      // Location montado a partir do caminho JÁ normalizado e sempre começando com UMA barra:
      // usar o pathname cru permitia "/.//evil.com/.." -> Location: //evil.com/... (redirecionamento aberto).
      const loc = '/' + path.relative(DIST, file).split(path.sep).map(encodeURIComponent).join('/') + '/' + (search || '');
      return send(res, 301, '', { Location: loc });
    }
    if (err || !st.isFile()) return send(res, 404, 'Página não encontrada');
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': ext === '.html' ? 'public, max-age=300' : 'public, max-age=3600',
      ...SECURITY,
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file)
      .on('error', () => res.destroy())
      .pipe(res);
  });
}

function clickStats() {
  const by = Object.create(null);
  let total = 0;
  try {
    for (const line of fs.readFileSync(CLICKS, 'utf8').split('\n')) {
      if (!line) continue;
      let r;
      try {
        r = JSON.parse(line);
      } catch {
        continue; // linha corrompida (ex.: gravação interrompida) não zera as estatísticas
      }
      if (!r || typeof r.id !== 'string') continue;
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
    // Concatena em vez de usar req.url como relativo: "//bebe" seria lido como host "bebe" (protocol-relative).
    url = req.url.startsWith('/') ? new URL('http://localhost' + req.url) : new URL(req.url);
    if (!/^https?:$/.test(url.protocol)) throw new Error('protocolo');
  } catch {
    return send(res, 400, 'Requisição inválida');
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Método não permitido', { Allow: 'GET, HEAD' });
  const p = url.pathname;
  let m;
  try {
    if ((m = p.match(/^\/go\/(.+)$/))) return handleGo(req, res, decodeURIComponent(m[1]));
    if ((m = p.match(/^\/api\/products\/([a-z0-9_-]+)$/))) {
      const data = readJSON(path.join(DATA, `products/${m[1]}.json`), null);
      if (!data) return send(res, 404, '{"error":"nicho não encontrado"}', { 'Content-Type': MIME['.json'] });
      return send(res, 200, JSON.stringify(data), { 'Content-Type': MIME['.json'] });
    }
    if (p === '/api/status')
      return send(res, 200, JSON.stringify(readJSON(path.join(DATA, 'status.json'), {})), { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
    if (p === '/api/clicks') return send(res, 200, JSON.stringify(clickStats()), { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
    if (p.startsWith('/api/')) return send(res, 404, '{"error":"rota não encontrada"}', { 'Content-Type': MIME['.json'] });
    return handleStatic(req, res, p, url.search);
  } catch (e) {
    return send(res, 400, 'Requisição inválida');
  }
});

/** "HH:MM" -> {h, m}; lança se inválido (antes "6" ou "25:00" viravam NaN e o timer disparava em loop). */
function parseHHMM(hhmm) {
  const mt = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(hhmm || '').trim());
  if (!mt) throw new Error(`horário inválido para --schedule: "${hhmm}" (use HH:MM, 00:00–23:59)`);
  return { h: +mt[1], m: +mt[2] };
}

/** Próxima ocorrência de HH:MM (hora local do servidor) estritamente depois de `now`. */
function nextRun(hhmm, now = new Date()) {
  const { h, m } = parseHHMM(hhmm);
  const at = new Date(now);
  at.setHours(h, m, 0, 0);
  if (at <= now) {
    at.setDate(at.getDate() + 1);
    at.setHours(h, m, 0, 0); // reaplica: em dia de mudança de horário setDate pode deslocar a hora
  }
  return at;
}

/** Comando que o agendador dispara: coleta (pipeline) e depois build, num processo filho. */
function dailyCommand() {
  const code = `require(${JSON.stringify(path.join(ROOT, 'src/pipeline'))}).run()` +
    `.then(()=>require(${JSON.stringify(path.join(ROOT, 'src/build'))}).build())` +
    `.catch((e)=>{console.error(e);process.exit(1)})`;
  return { cmd: process.execPath, args: ['-e', code], cwd: ROOT };
}

/** Agendador diário simples (alternativa ao crontab do sistema). */
function schedule(hhmm, { spawnFn = spawn, log = console.log } = {}) {
  parseHHMM(hhmm); // falha cedo, antes de subir timers
  let running = false;
  let timer = null;
  const runDaily = () => {
    if (running) return log('[cron] coleta anterior ainda em andamento — pulando');
    running = true;
    log(`[cron] ${new Date().toISOString()} iniciando coleta diária`);
    const { cmd, args, cwd } = dailyCommand();
    const child = spawnFn(cmd, args, { cwd, stdio: 'inherit' });
    child.on('error', (e) => {
      running = false;
      log(`[cron] falha ao iniciar coleta: ${e.message}`);
    });
    child.on('exit', (code) => {
      running = false;
      log(`[cron] coleta terminou (código ${code})`);
    });
  };
  const next = (after) => {
    const at = nextRun(hhmm, after);
    // after = horário alvo + 1 min: se o timer disparar alguns ms adiantado, não reagenda para o mesmo minuto.
    timer = setTimeout(() => {
      runDaily();
      next(new Date(Math.max(Date.now(), at.getTime() + 60000)));
    }, Math.max(0, at - Date.now()));
    log(`[cron] próxima coleta: ${at.toString()}`);
  };
  next(new Date());
  return { stop: () => clearTimeout(timer) };
}

if (require.main === module) {
  const port = parseInt(process.env.PORT || '8080', 10);
  server.listen(port, () => console.log(`Radar no ar: http://localhost:${port}`));
  const i = process.argv.indexOf('--schedule');
  if (i > -1) {
    try {
      schedule(process.argv[i + 1] || '06:00');
    } catch (e) {
      console.error(e.message);
      process.exit(1);
    }
  }
}

module.exports = { server, schedule, nextRun, parseHHMM, dailyCommand };
