/**
 * Testes do servidor (src/server.js): estáticos, redirecionador /go/<id>, API, segurança e agendador.
 * Roda contra diretórios temporários (RADAR_DATA_DIR / RADAR_DIST_DIR) para não sujar data/ e dist/ reais.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const EventEmitter = require('events');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-srv-'));
const DATA = path.join(TMP, 'data');
const DIST = path.join(TMP, 'dist');
process.env.RADAR_DATA_DIR = DATA;
process.env.RADAR_DIST_DIR = DIST;

const write = (f, s) => {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, s);
};
write(path.join(DIST, 'index.html'), '<!DOCTYPE html><title>hub</title>');
write(path.join(DIST, 'bebe/index.html'), '<!DOCTYPE html><title>bebe</title>');
write(path.join(DIST, 'assets/app.js'), '/* app */');
write(path.join(DIST, 'status.html'), '<!DOCTYPE html><title>status</title>');
write(path.join(DIST, '.env'), 'SEGREDO=1');
write(path.join(TMP, 'segredo.txt'), 'fora do dist');
write(
  path.join(DATA, 'links.json'),
  JSON.stringify({
    'amazon:B0TEST0001': 'https://www.amazon.com.br/dp/B0TEST0001?tag=x-20',
    'amazon:EVIL': 'https://evil.example.com/phish', // host fora da lista: nunca redireciona
    'amazon:HTTP': 'http://www.amazon.com.br/dp/X', // http puro: recusado
    'amazon:JS': 'javascript:alert(1)',
  })
);
write(path.join(DATA, 'products/bebe.json'), JSON.stringify({ niche: 'bebe', products: [{ id: 'amazon:B0TEST0001' }] }));
write(path.join(DATA, 'status.json'), JSON.stringify({ generatedAt: '2026-11-09T00:00:00Z', niches: {} }));
write(path.join(DATA, 'clicks.jsonl'), '{"t":"x","id":"amazon:B0TEST0001"}\n{corrompida\n');

const { server, nextRun, parseHHMM, dailyCommand, schedule } = require('../src/server');
const CLICKS = path.join(DATA, 'clicks.jsonl');
let port;

before(() => new Promise((r) => server.listen(0, '127.0.0.1', () => ((port = server.address().port), r()))));
after(() => {
  server.close();
  fs.rmSync(TMP, { recursive: true, force: true });
});

/** Requisição crua (sem normalização de caminho do cliente). */
function raw(method, target, headers = '') {
  return new Promise((resolve, reject) => {
    const s = net.connect(port, '127.0.0.1');
    const chunks = [];
    s.on('data', (d) => chunks.push(d));
    s.on('error', reject);
    s.on('close', () => {
      const txt = Buffer.concat(chunks).toString('utf8');
      const [head, ...rest] = txt.split('\r\n\r\n');
      const lines = head.split('\r\n');
      const h = {};
      for (const l of lines.slice(1)) {
        const i = l.indexOf(':');
        h[l.slice(0, i).toLowerCase()] = l.slice(i + 1).trim();
      }
      resolve({ status: parseInt(lines[0].split(' ')[1], 10), headers: h, body: rest.join('\r\n\r\n') });
    });
    s.write(`${method} ${target} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n${headers}\r\n`);
  });
}
const get = (t) => raw('GET', t);
const lines = () => fs.readFileSync(CLICKS, 'utf8').split('\n').filter(Boolean).length;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('estáticos: páginas, content-type, HEAD, 404 e diretório sem barra', async () => {
  let r = await get('/');
  assert.equal(r.status, 200);
  assert.match(r.headers['content-type'], /^text\/html; charset=utf-8/);
  assert.equal(r.headers['x-content-type-options'], 'nosniff');
  r = await get('/bebe/');
  assert.equal(r.status, 200);
  assert.match(r.body, /bebe/);
  r = await get('/assets/app.js');
  assert.match(r.headers['content-type'], /^text\/javascript/);
  r = await get('/status.html');
  assert.equal(r.status, 200);

  r = await raw('HEAD', '/bebe/');
  assert.equal(r.status, 200);
  assert.equal(r.body, '');
  assert.ok(+r.headers['content-length'] > 0);

  r = await get('/bebe');
  assert.equal(r.status, 301);
  assert.equal(r.headers.location, '/bebe/');
  r = await get('/bebe?x=1');
  assert.equal(r.headers.location, '/bebe/?x=1');

  assert.equal((await get('/nao-existe')).status, 404);
  assert.equal((await get('/bebe/nao.html')).status, 404);
  assert.equal((await get('/.env')).status, 404, 'arquivo oculto não é servido');
});

test('path traversal, barra invertida, null byte e URL malformada', async () => {
  for (const t of ['/../segredo.txt', '/..%2fsegredo.txt', '/%2e%2e/segredo.txt', '/%2e%2e%2fsegredo.txt', '/bebe/../../segredo.txt',
    '/..%5csegredo.txt', '/..\\segredo.txt', '/%252e%252e/segredo.txt', '/....//segredo.txt', '/..%2f..%2f..%2fetc%2fpasswd']) {
    const r = await get(t);
    assert.ok([400, 403, 404].includes(r.status), `${t} -> ${r.status}`);
    assert.doesNotMatch(r.body, /fora do dist|root:/, t);
  }
  assert.equal((await get('/index.html%00.png')).status, 400);
  assert.equal((await get('/%00')).status, 400);
  assert.equal((await get('/bebe/%')).status, 400);
  assert.equal((await get('/%E0%A4%A')).status, 400);
  assert.equal((await get('*')).status, 400);
});

test('redirecionamento de diretório nunca aponta para outro host', async () => {
  for (const t of ['/.//evil.com/..%2fbebe', '//evil.com/..%2fbebe', '//bebe', '/\\evil.com/..%2fbebe', 'http://evil.com/bebe']) {
    const r = await get(t);
    if (r.headers.location) assert.match(r.headers.location, /^\/(?!\/|\\)/, `${t} -> ${r.headers.location}`);
  }
});

test('métodos não-GET recebem 405 com Allow', async () => {
  for (const m of ['POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH']) {
    const r = await raw(m, '/go/amazon%3AB0TEST0001', 'Content-Length: 0\r\n');
    assert.equal(r.status, 405, m);
    assert.equal(r.headers.allow, 'GET, HEAD');
  }
});

test('/go/<id>: 302 para a loja e grava o clique', async () => {
  const n0 = lines();
  const r = await raw('GET', '/go/amazon%3AB0TEST0001', 'Referer: http://localhost/bebe/\r\nUser-Agent: teste\r\n');
  assert.equal(r.status, 302);
  assert.equal(r.headers.location, 'https://www.amazon.com.br/dp/B0TEST0001?tag=x-20');
  assert.equal(r.headers['cache-control'], 'no-store');
  await wait(100);
  assert.equal(lines(), n0 + 1);
  const last = JSON.parse(fs.readFileSync(CLICKS, 'utf8').trim().split('\n').pop());
  assert.equal(last.id, 'amazon:B0TEST0001');
  assert.equal(last.ref, 'http://localhost/bebe/');
  // id sem codificar também funciona; query string é ignorada (não vira destino)
  const r2 = await get('/go/amazon:B0TEST0001?next=https://evil.com');
  assert.equal(r2.headers.location, 'https://www.amazon.com.br/dp/B0TEST0001?tag=x-20');
});

test('/go/<id>: HEAD redireciona mas não conta clique', async () => {
  await wait(50);
  const n0 = lines();
  const r = await raw('HEAD', '/go/amazon%3AB0TEST0001');
  assert.equal(r.status, 302);
  await wait(100);
  assert.equal(lines(), n0);
});

test('/go/<id>: inexistente -> 404 e não é redirecionador aberto', async () => {
  const n0 = lines();
  for (const t of ['/go/nope', '/go/https://evil.com', '/go/https%3A%2F%2Fevil.com', '/go///evil.com', '/go/%2F%2Fevil.com',
    '/go/__proto__', '/go/constructor', '/go/toString', '/go/amazon%3AB0TEST0001/', '/go/amazon%3AB0TEST0001%0d%0aSet-Cookie:x=1',
    '/go/amazon%3AEVIL', '/go/amazon%3AHTTP', '/go/amazon%3AJS', '/go/', '/go']) {
    const r = await get(t);
    assert.equal(r.status, 404, t);
    assert.equal(r.headers.location, undefined, t);
  }
  assert.equal((await get('/go/%')).status, 400);
  await wait(100);
  assert.equal(lines(), n0, 'nenhum clique gravado para ids inválidos');
});

test('/api/*', async () => {
  let r = await get('/api/products/bebe');
  assert.equal(r.status, 200);
  assert.match(r.headers['content-type'], /^application\/json/);
  assert.equal(JSON.parse(r.body).products[0].id, 'amazon:B0TEST0001');
  r = await get('/api/products/nope');
  assert.equal(r.status, 404);
  assert.match(r.headers['content-type'], /^application\/json/);
  for (const t of ['/api/products/..%2f..%2fpackage', '/api/products/', '/api/', '/api/products/bebe/']) assert.equal((await get(t)).status, 404, t);
  r = await get('/api/status');
  assert.equal(JSON.parse(r.body).generatedAt, '2026-11-09T00:00:00Z');
  r = await get('/api/clicks');
  const c = JSON.parse(r.body);
  assert.ok(c.total >= 1, 'linha corrompida no jsonl não zera as estatísticas');
  assert.equal(c.top[0].id, 'amazon:B0TEST0001');
});

test('agendador: validação de HH:MM', () => {
  assert.deepEqual(parseHHMM('06:00'), { h: 6, m: 0 });
  assert.deepEqual(parseHHMM('6:05'), { h: 6, m: 5 });
  assert.deepEqual(parseHHMM('23:59'), { h: 23, m: 59 });
  for (const bad of ['6', '25:00', '24:00', '06:60', 'ab:cd', '', undefined, '06:00:00', '-1:00']) assert.throws(() => parseHHMM(bad), bad);
});

test('agendador: cálculo do próximo horário (hora local)', () => {
  const d = (y, mo, da, h, mi, s = 0, ms = 0) => new Date(y, mo - 1, da, h, mi, s, ms);
  assert.equal(+nextRun('06:00', d(2026, 11, 10, 5, 59)), +d(2026, 11, 10, 6, 0));
  assert.equal(+nextRun('06:00', d(2026, 11, 10, 6, 0)), +d(2026, 11, 11, 6, 0), 'exatamente no horário -> amanhã');
  assert.equal(+nextRun('06:00', d(2026, 11, 10, 6, 0, 0, 1)), +d(2026, 11, 11, 6, 0));
  assert.equal(+nextRun('23:59', d(2026, 12, 31, 23, 59, 30)), +d(2027, 1, 1, 23, 59), 'virada de ano');
  assert.equal(+nextRun('00:00', d(2026, 2, 28, 12, 0)), +d(2026, 3, 1, 0, 0), 'fim de fevereiro');
  const delta = nextRun('12:00', d(2026, 6, 1, 12, 30)) - d(2026, 6, 1, 12, 30);
  assert.ok(delta > 0 && delta <= 24 * 3600e3);
});

test('agendador: dispara pipeline+build num processo filho e não sobrepõe execuções', async () => {
  const { cmd, args, cwd } = dailyCommand();
  assert.equal(cmd, process.execPath);
  assert.equal(args[0], '-e');
  assert.match(args[1], /src\/pipeline"\)\.run\(\)\.then\(\(\)=>require\(".*src\/build"\)\.build\(\)\)/);
  assert.ok(fs.existsSync(path.join(cwd, 'src/pipeline.js')));
  new Function(args[1]); // sintaxe válida

  const realSetTimeout = global.setTimeout;
  const timers = [];
  global.setTimeout = (fn, ms) => (timers.push({ fn, ms }), 0);
  const spawned = [];
  const children = [];
  try {
    const s = schedule('06:00', {
      spawnFn: (...a) => {
        spawned.push(a);
        const ch = new EventEmitter();
        children.push(ch);
        return ch;
      },
      log: () => {},
    });
    assert.equal(timers.length, 1);
    assert.ok(timers[0].ms > 0 && timers[0].ms <= 24 * 3600e3, `atraso ${timers[0].ms}`);
    timers[0].fn(); // dispara
    assert.equal(spawned.length, 1);
    assert.deepEqual(spawned[0][1], args);
    assert.equal(timers.length, 2, 'reagendou');
    assert.ok(timers[1].ms > 23 * 3600e3, 'próxima é no dia seguinte, não no mesmo minuto');
    timers[1].fn(); // filho anterior ainda rodando -> pula
    assert.equal(spawned.length, 1);
    children[0].emit('exit', 0);
    timers[2].fn();
    assert.equal(spawned.length, 2);
    children[1].emit('error', new Error('ENOENT')); // falha ao iniciar não trava o agendador
    timers[3].fn();
    assert.equal(spawned.length, 3);
    s.stop();
  } finally {
    global.setTimeout = realSetTimeout;
  }
  assert.throws(() => schedule('6', { spawnFn: () => {}, log: () => {} }));
});
