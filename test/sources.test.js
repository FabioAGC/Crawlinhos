/**
 * Testes dos adaptadores Mercado Livre, Shopee e Magalu.
 * Nenhum teste acessa a rede: globalThis.fetch é trocado por um mock.
 * Os fixtures em test/fixtures/ foram escritos à mão no formato documentado das APIs
 * (não são respostas reais) — ver o campo "_fixture" / comentário no topo de cada um.
 */
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const ml = require('../src/sources/mercadolivre');
const shopee = require('../src/sources/shopee');
const magalu = require('../src/sources/magalu');

const fx = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
const fxJSON = (name) => JSON.parse(fx(name));

const ENV_KEYS = ['ML_ACCESS_TOKEN', 'ML_CLIENT_ID', 'ML_CLIENT_SECRET', 'ML_REFRESH_TOKEN', 'ML_TOKEN_FILE', 'ML_SEARCH_MODE',
  'SHOPEE_APP_ID', 'SHOPEE_SECRET', 'MAGALU_STORE'];
const realFetch = globalThis.fetch;
let savedEnv;
let tmpDir;
let calls;

/** Troca fetch por um roteador: handler(url, opts) -> { status, body } (body string ou objeto). */
function mockFetch(handler) {
  calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    const call = { url: String(url), method: opts.method || 'GET', headers: opts.headers || {}, body: opts.body };
    calls.push(call);
    const r = await handler(call);
    const text = typeof r.body === 'string' ? r.body : JSON.stringify(r.body ?? {});
    return { status: r.status, url: call.url, text: async () => text };
  };
}

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-test-'));
  process.env.ML_TOKEN_FILE = path.join(tmpDir, 'ml-token.json'); // nunca toca data/ml-token.json
  ml._config.retryDelayMs = 1;
  globalThis.fetch = async () => { throw new Error('rede não deveria ser acessada neste teste'); };
});

afterEach(() => {
  globalThis.fetch = realFetch;
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const rejectsWithCode = (p, code) => assert.rejects(p, (e) => {
  assert.equal(e.code, code, `esperava ${code}, veio ${e.code}: ${e.message}`);
  return true;
});

// ============================================================ Mercado Livre

test('ML normalize: item de /sites/MLB/search (fixture no formato documentado)', () => {
  const out = fxJSON('ml-search.json').results.map(ml.normalize);
  assert.deepEqual(out[0], {
    source: 'mercadolivre',
    sourceId: 'MLB1111111111',
    title: 'Fralda  Infantil Tamanho G 80 Unidades',
    price: 79.9,
    listPrice: 99.9,
    image: 'https://http2.mlstatic.com/D_111111-MLB11111111111_012025-O.jpg',
    url: 'https://produto.mercadolivre.com.br/MLB-1111111111-fralda-infantil-g-80-unidades-_JM',
    rating: null,
    reviews: null,
    sold: null,
    freeShipping: true,
  });
  assert.equal(out[1].listPrice, null);
  assert.equal(out[1].sold, 500);
  assert.equal(out[1].image, 'https://http2.mlstatic.com/D_222222-MLB22222222222_012025-O.webp');
  assert.equal(out[1].freeShipping, false);
  // price nulo mas sale_price presente
  assert.equal(out[2].price, 30);
  assert.equal(out[2].listPrice, 40);
  assert.equal(out[3], null, 'sem preço');
  assert.equal(out[4], null, 'sem permalink');
});

test('ML normalize: entradas inválidas não lançam', () => {
  for (const v of [null, undefined, 'x', 42, {}, { id: 'MLB1' }, { id: 'MLB1', title: 't', price: 0, permalink: 'https://x' },
    { id: 'MLB1', title: 't', price: 10, permalink: 'javascript:alert(1)' },
    { id: 'MLA1', title: 't', price: 10, currency_id: 'ARS', permalink: 'https://x' }])
    assert.equal(ml.normalize(v), null);
});

test('ML normalizeCatalog: produto de catálogo com buy_box_winner', () => {
  const p = ml.normalizeCatalog(fxJSON('ml-product-detail.json'));
  assert.equal(p.sourceId, 'MLB19000001');
  assert.equal(p.title, 'Fralda Catalogo G');
  assert.equal(p.price, 59.9);
  assert.equal(p.listPrice, 74.9);
  assert.equal(p.url, 'https://www.mercadolivre.com.br/fralda-catalogo-g/p/MLB19000001');
  assert.equal(p.freeShipping, true);
  assert.equal(ml.normalizeCatalog({ id: 'MLB1', name: 'sem oferta', buy_box_winner: null }), null);
  assert.equal(ml.normalizeCatalog(null), null);
});

test('ML search: sem credencial -> NO_CREDENTIALS, sem tocar na rede', async () => {
  await rejectsWithCode(ml.search({ query: 'fralda' }), 'NO_CREDENTIALS');
});

test('ML search: ML_ACCESS_TOKEN direto -> Bearer no header, limit e query codificados', async () => {
  process.env.ML_ACCESS_TOKEN = 'APP_USR-direto';
  process.env.ML_SEARCH_MODE = 'items';
  mockFetch(() => ({ status: 200, body: fxJSON('ml-search.json') }));
  const items = await ml.search({ query: 'fralda pampers G', limit: 2 });
  assert.equal(items.length, 2);
  assert.equal(calls.length, 1);
  const u = new URL(calls[0].url);
  assert.equal(u.origin + u.pathname, 'https://api.mercadolibre.com/sites/MLB/search');
  assert.equal(u.searchParams.get('q'), 'fralda pampers G');
  assert.equal(u.searchParams.get('limit'), '2');
  assert.equal(calls[0].headers.Authorization, 'Bearer APP_USR-direto');
});

test('ML search: limit acima de 50 é reduzido para 50', async () => {
  process.env.ML_ACCESS_TOKEN = 't';
  mockFetch(() => ({ status: 200, body: { results: [] } }));
  assert.deepEqual(await ml.search({ query: 'x', limit: 500 }), []);
  assert.equal(new URL(calls[0].url).searchParams.get('limit'), '50');
});

test('ML search: 401 com token direto -> NO_CREDENTIALS', async () => {
  process.env.ML_ACCESS_TOKEN = 'vencido';
  mockFetch(() => ({ status: 401, body: { message: 'invalid access token', error: 'not_found', status: 401 } }));
  await rejectsWithCode(ml.search({ query: 'x' }), 'NO_CREDENTIALS');
  assert.equal(calls.length, 1);
});

test('ML search: 403 em modo items -> BLOCKED', async () => {
  process.env.ML_ACCESS_TOKEN = 't';
  process.env.ML_SEARCH_MODE = 'items';
  mockFetch(() => ({ status: 403, body: { message: 'forbidden', error: 'forbidden', status: 403, cause: [] } }));
  await rejectsWithCode(ml.search({ query: 'x' }), 'BLOCKED');
});

test('ML search: modo auto, 403 na busca e no catálogo -> BLOCKED', async () => {
  process.env.ML_ACCESS_TOKEN = 't';
  mockFetch(() => ({ status: 403, body: { code: 'PA_UNAUTHORIZED_RESULT_FROM_POLICIES', message: 'At least one policy returned UNAUTHORIZED.' } }));
  await rejectsWithCode(ml.search({ query: 'x' }), 'BLOCKED');
  assert.deepEqual(calls.map((c) => new URL(c.url).pathname), ['/sites/MLB/search', '/products/search']);
});

test('ML search: modo auto cai para o catálogo quando /sites/MLB/search dá 403', async () => {
  process.env.ML_ACCESS_TOKEN = 't';
  mockFetch(({ url }) => {
    const p = new URL(url).pathname;
    if (p === '/sites/MLB/search') return { status: 403, body: { message: 'forbidden' } };
    if (p === '/products/search') return { status: 200, body: fxJSON('ml-products-search.json') };
    if (p === '/products/MLB19000001') return { status: 200, body: fxJSON('ml-product-detail.json') };
    if (p === '/products/MLB19000002') return { status: 200, body: { id: 'MLB19000002', name: 'Fralda sem oferta', buy_box_winner: null } };
    return { status: 404, body: {} };
  });
  const items = await ml.search({ query: 'fralda', limit: 5 });
  assert.equal(items.length, 1);
  assert.equal(items[0].sourceId, 'MLB19000001');
  assert.equal(items[0].price, 59.9);
});

test('ML search: 429 repete uma vez; se persistir -> HTTP (não desativa a fonte)', async () => {
  process.env.ML_ACCESS_TOKEN = 't';
  process.env.ML_SEARCH_MODE = 'items';
  let n = 0;
  mockFetch(() => (++n === 1 ? { status: 429, body: {} } : { status: 200, body: fxJSON('ml-search.json') }));
  assert.equal((await ml.search({ query: 'x', limit: 12 })).length, 3);
  assert.equal(calls.length, 2);
  mockFetch(() => ({ status: 429, body: {} }));
  await rejectsWithCode(ml.search({ query: 'x' }), 'HTTP');
  assert.equal(calls.length, 2);
});

test('ML search: 500 e corpo não-JSON -> HTTP', async () => {
  process.env.ML_ACCESS_TOKEN = 't';
  process.env.ML_SEARCH_MODE = 'items';
  mockFetch(() => ({ status: 500, body: 'oops' }));
  await rejectsWithCode(ml.search({ query: 'x' }), 'HTTP');
  mockFetch(() => ({ status: 200, body: '<html>' }));
  await rejectsWithCode(ml.search({ query: 'x' }), 'HTTP');
});

function setRefreshEnv() {
  process.env.ML_CLIENT_ID = '1234567890';
  process.env.ML_CLIENT_SECRET = 'segredo-app';
  process.env.ML_REFRESH_TOKEN = 'TG-inicial';
  process.env.ML_SEARCH_MODE = 'items';
}
const tokenState = () => JSON.parse(fs.readFileSync(process.env.ML_TOKEN_FILE, 'utf8'));

test('ML OAuth: renova via refresh_token, grava o token rotacionado e reutiliza o cache', async () => {
  setRefreshEnv();
  mockFetch(({ url }) => (new URL(url).pathname === '/oauth/token'
    ? { status: 200, body: fxJSON('ml-oauth-token.json') }
    : { status: 200, body: fxJSON('ml-search.json') }));
  await ml.search({ query: 'fralda' });
  assert.equal(calls.length, 2);
  const [tok, srch] = calls;
  assert.equal(tok.url, 'https://api.mercadolibre.com/oauth/token');
  assert.equal(tok.method, 'POST');
  assert.equal(tok.headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.deepEqual(Object.fromEntries(new URLSearchParams(tok.body)), {
    grant_type: 'refresh_token',
    client_id: '1234567890',
    client_secret: 'segredo-app',
    refresh_token: 'TG-inicial',
  });
  assert.equal(srch.headers.Authorization, 'Bearer APP_USR-FAKE-ACCESS-NOVO');

  const st = tokenState();
  assert.equal(st.access_token, 'APP_USR-FAKE-ACCESS-NOVO');
  assert.equal(st.refresh_token, 'TG-FAKE-REFRESH-ROTACIONADO');
  assert.ok(st.expires_at > Date.now() + 5 * 3600e3 && st.expires_at <= Date.now() + 6 * 3600e3);
  assert.equal(fs.statSync(process.env.ML_TOKEN_FILE).mode & 0o777, 0o600);

  // 2ª busca: token em cache ainda válido -> não chama /oauth/token de novo
  await ml.search({ query: 'lenco' });
  assert.equal(calls.filter((c) => c.url.endsWith('/oauth/token')).length, 1);
});

test('ML OAuth: token em cache vencido -> usa o refresh_token ROTACIONADO do arquivo, não o do .env', async () => {
  setRefreshEnv();
  mockFetch(({ url }) => (new URL(url).pathname === '/oauth/token'
    ? { status: 200, body: fxJSON('ml-oauth-token.json') }
    : { status: 200, body: { results: [] } }));
  await ml.search({ query: 'a' });
  const st = tokenState();
  st.expires_at = Date.now() - 1000;
  fs.writeFileSync(process.env.ML_TOKEN_FILE, JSON.stringify(st));
  mockFetch(({ url }) => (new URL(url).pathname === '/oauth/token'
    ? { status: 200, body: { access_token: 'APP_USR-3', expires_in: 21600, refresh_token: 'TG-3' } }
    : { status: 200, body: { results: [] } }));
  await ml.search({ query: 'b' });
  assert.equal(new URLSearchParams(calls[0].body).get('refresh_token'), 'TG-FAKE-REFRESH-ROTACIONADO');
  assert.equal(tokenState().refresh_token, 'TG-3');
});

test('ML OAuth: ML_REFRESH_TOKEN trocado no .env (reautorização) tem prioridade sobre o arquivo', async () => {
  setRefreshEnv();
  mockFetch(({ url }) => (new URL(url).pathname === '/oauth/token'
    ? { status: 200, body: fxJSON('ml-oauth-token.json') }
    : { status: 200, body: { results: [] } }));
  await ml.search({ query: 'a' });
  process.env.ML_REFRESH_TOKEN = 'TG-reautorizado';
  await ml.search({ query: 'b' });
  const tokenCalls = calls.filter((c) => c.url.endsWith('/oauth/token'));
  assert.equal(tokenCalls.length, 2);
  assert.equal(new URLSearchParams(tokenCalls[1].body).get('refresh_token'), 'TG-reautorizado');
});

test('ML OAuth: 401 na busca com token em cache -> renova uma vez e repete', async () => {
  setRefreshEnv();
  fs.writeFileSync(process.env.ML_TOKEN_FILE, JSON.stringify({
    access_token: 'APP_USR-revogado', refresh_token: 'TG-arquivo', expires_at: Date.now() + 3600e3, client_id: '1234567890',
  }));
  mockFetch(({ url, headers }) => {
    if (new URL(url).pathname === '/oauth/token') return { status: 200, body: fxJSON('ml-oauth-token.json') };
    return headers.Authorization === 'Bearer APP_USR-revogado'
      ? { status: 401, body: { message: 'invalid access token' } }
      : { status: 200, body: fxJSON('ml-search.json') };
  });
  const items = await ml.search({ query: 'x' });
  assert.equal(items.length, 3);
  assert.deepEqual(calls.map((c) => new URL(c.url).pathname), ['/sites/MLB/search', '/oauth/token', '/sites/MLB/search']);
  assert.equal(new URLSearchParams(calls[1].body).get('refresh_token'), 'TG-arquivo');
});

test('ML OAuth: 401 mesmo depois de renovar -> NO_CREDENTIALS (sem laço infinito)', async () => {
  setRefreshEnv();
  mockFetch(({ url }) => (new URL(url).pathname === '/oauth/token'
    ? { status: 200, body: fxJSON('ml-oauth-token.json') }
    : { status: 401, body: {} }));
  await rejectsWithCode(ml.search({ query: 'x' }), 'NO_CREDENTIALS');
  assert.ok(calls.length <= 4);
});

test('ML OAuth: refresh_token recusado (400 invalid_grant) -> NO_CREDENTIALS', async () => {
  setRefreshEnv();
  mockFetch(() => ({ status: 400, body: { message: 'Error validating grant.', error: 'invalid_grant', status: 400, cause: [] } }));
  await rejectsWithCode(ml.search({ query: 'x' }), 'NO_CREDENTIALS');
  assert.equal(calls.length, 1);
  assert.equal(fs.existsSync(process.env.ML_TOKEN_FILE), false);
});

test('ML OAuth: renovação recusada mas ML_ACCESS_TOKEN definido -> usa o token direto', async () => {
  setRefreshEnv();
  process.env.ML_ACCESS_TOKEN = 'APP_USR-manual';
  mockFetch(({ url }) => (new URL(url).pathname === '/oauth/token'
    ? { status: 400, body: { error: 'invalid_grant' } }
    : { status: 200, body: { results: [] } }));
  assert.deepEqual(await ml.search({ query: 'x' }), []);
  assert.equal(calls[1].headers.Authorization, 'Bearer APP_USR-manual');
});

test('ML OAuth: buscas simultâneas fazem uma única renovação (refresh_token é de uso único)', async () => {
  setRefreshEnv();
  mockFetch(async ({ url }) => {
    await new Promise((r) => setTimeout(r, 5));
    return new URL(url).pathname === '/oauth/token'
      ? { status: 200, body: fxJSON('ml-oauth-token.json') }
      : { status: 200, body: { results: [] } };
  });
  await Promise.all([ml.search({ query: 'a' }), ml.search({ query: 'b' }), ml.search({ query: 'c' })]);
  assert.equal(calls.filter((c) => c.url.endsWith('/oauth/token')).length, 1);
});

// ============================================================ Shopee

test('Shopee sign: vetor fixo sha256(appId + ts + payload + secret)', () => {
  // Hash calculado fora do código: printf '%s' '1234561700000000{"query":"{ x }"}segredo' | sha256sum
  const s = shopee.sign('123456', 'segredo', '{"query":"{ x }"}', 1700000000);
  assert.equal(s.signature, 'd12a33877a43df2c9e177d7aa2363990300b6ae5e108428c46c3d24d4036d900');
  assert.equal(s.header, 'SHA256 Credential=123456, Timestamp=1700000000, Signature=d12a33877a43df2c9e177d7aa2363990300b6ae5e108428c46c3d24d4036d900');
  assert.equal(s.ts, 1700000000);
});

test('Shopee sign: timestamp padrão em segundos (não milissegundos)', () => {
  const { ts } = shopee.sign('1', 's', '{}');
  assert.ok(Math.abs(ts - Date.now() / 1000) < 5);
});

test('Shopee normalize: nó de productOfferV2 (fixture no formato documentado)', () => {
  const nodes = fxJSON('shopee-productOfferV2.json').data.productOfferV2.nodes.map(shopee.normalize);
  assert.deepEqual(nodes[0], {
    source: 'shopee',
    sourceId: '23456789012',
    title: 'Kit 3 Body Bebe Manga Curta',
    price: 45,
    listPrice: 50,
    image: 'https://down-br.img.susercontent.com/file/br-11134207-fake',
    url: 'https://shopee.com.br/product/345678901/23456789012',
    affiliateUrl: 'https://s.shopee.com.br/FAKE123',
    rating: 4.8,
    reviews: null,
    sold: 1520,
    commissionRate: 0.07,
    seller: 'Loja Exemplo',
  });
  // sem productLink: monta a URL por shopId/itemId; sem offerLink: affiliateUrl null
  assert.equal(nodes[1].url, 'https://shopee.com.br/product/222/111');
  assert.equal(nodes[1].affiliateUrl, null);
  assert.equal(nodes[1].listPrice, null);
  assert.equal(nodes[1].rating, null);
  assert.equal(nodes[2], null);
});

test('Shopee normalize: entradas inválidas não lançam', () => {
  for (const v of [null, undefined, 'x', {}, { itemId: 1 }, { itemId: 1, productName: 'a', priceMin: 'abc' }])
    assert.equal(shopee.normalize(v), null);
});

test('Shopee search: sem credencial -> NO_CREDENTIALS, sem tocar na rede', async () => {
  await rejectsWithCode(shopee.search({ query: 'x' }), 'NO_CREDENTIALS');
  process.env.SHOPEE_APP_ID = '123';
  await rejectsWithCode(shopee.search({ query: 'x' }), 'NO_CREDENTIALS');
});

function setShopeeEnv() {
  process.env.SHOPEE_APP_ID = '123456';
  process.env.SHOPEE_SECRET = 'segredo';
}

test('Shopee search: POST assinado; a assinatura confere com o corpo enviado', async () => {
  setShopeeEnv();
  mockFetch(() => ({ status: 200, body: fxJSON('shopee-productOfferV2.json') }));
  const items = await shopee.search({ query: 'body "bebê" \\ teste', limit: 2 });
  assert.equal(items.length, 2);
  const c = calls[0];
  assert.equal(c.url, 'https://open-api.affiliate.shopee.com.br/graphql');
  assert.equal(c.method, 'POST');
  assert.equal(c.headers['Content-Type'], 'application/json');
  const m = c.headers.Authorization.match(/^SHA256 Credential=123456, Timestamp=(\d{10}), Signature=([0-9a-f]{64})$/);
  assert.ok(m, c.headers.Authorization);
  const expected = crypto.createHash('sha256').update(`123456${m[1]}${c.body}segredo`).digest('hex');
  assert.equal(m[2], expected);
  const gql = JSON.parse(c.body).query;
  assert.match(gql, /productOfferV2\(keyword: "body \\"bebê\\" \\\\ teste", limit: 2, page: 1, sortType: 2\)/);
  assert.doesNotMatch(gql, /\bprice\b(?!Min|Max|DiscountRate)/, 'campo obsoleto "price" não deve ser pedido');
});

test('Shopee search: erro GraphQL com HTTP 200 (assinatura inválida, 10020) -> NO_CREDENTIALS', async () => {
  setShopeeEnv();
  mockFetch(() => ({ status: 200, body: fxJSON('shopee-error-signature.json') }));
  await rejectsWithCode(shopee.search({ query: 'x' }), 'NO_CREDENTIALS');
});

test('Shopee search: mapeamento dos demais erros', async () => {
  setShopeeEnv();
  const gqlErr = (code, message) => ({ status: 200, body: { errors: [{ message, extensions: { code, message } }] } });
  const cases = [
    [gqlErr(10031, 'access deny'), 'BLOCKED'],
    [gqlErr(10035, 'no access to open api'), 'BLOCKED'],
    [gqlErr(10030, 'rate limit'), 'HTTP'],
    [gqlErr(11001, 'params error'), 'HTTP'],
    [{ status: 200, body: { errors: [{ message: 'Invalid Credential' }] } }, 'NO_CREDENTIALS'],
    [{ status: 401, body: {} }, 'NO_CREDENTIALS'],
    [{ status: 403, body: 'Forbidden' }, 'BLOCKED'],
    [{ status: 429, body: {} }, 'HTTP'],
    [{ status: 502, body: '<html>' }, 'HTTP'],
    [{ status: 200, body: 'não é json' }, 'HTTP'],
    [{ status: 200, body: { data: null } }, 'PARSE'],
  ];
  for (const [resp, code] of cases) {
    mockFetch(() => resp);
    await rejectsWithCode(shopee.search({ query: 'x' }), code);
  }
});

test('Shopee search: busca sem resultado devolve []', async () => {
  setShopeeEnv();
  mockFetch(() => ({ status: 200, body: { data: { productOfferV2: { nodes: [] } } } }));
  assert.deepEqual(await shopee.search({ query: 'x' }), []);
  mockFetch(() => ({ status: 200, body: { data: { productOfferV2: { nodes: null } } } }));
  assert.deepEqual(await shopee.search({ query: 'x' }), []);
});

// ============================================================ Magalu (fixture SINTÉTICO)

test('Magalu parseHtml + normalize: fixture SINTÉTICO (não é página real)', () => {
  const html = fx('magalu-busca-sintetico.html');
  assert.match(html, /FIXTURE SINTETICO/);
  const raw = magalu.parseHtml(html);
  assert.equal(raw.length, 3, 'deve escolher a lista principal (3), não o carrossel de anúncios (1)');
  const out = raw.map(magalu.normalize);
  assert.deepEqual(out[0], {
    source: 'magalu',
    sourceId: '234567801',
    title: 'Fralda Infantil  Sintetica G 80 Unidades',
    price: 89.9,
    listPrice: 129.9,
    image: 'https://a-static.mlcdn.com.br/500x500/fralda-sintetica/loja/234567801/abc.jpg',
    url: 'https://www.magazineluiza.com.br/fralda-infantil-sintetica-g/p/234567801/me/fral/',
    path: 'fralda-infantil-sintetica-g/p/234567801/me/fral/',
    rating: 4.7,
    reviews: 312,
    seller: 'Magalu',
  });
  // URL absoluta com query, preço "R$ 1.234,56", imagem "//..."
  assert.equal(out[1].price, 1234.56);
  assert.equal(out[1].listPrice, null);
  assert.equal(out[1].path, 'carrinho-de-bebe-sintetico/p/bb22cc33/bb/carr/');
  assert.equal(out[1].url, 'https://www.magazineluiza.com.br/carrinho-de-bebe-sintetico/p/bb22cc33/bb/carr/');
  assert.equal(out[1].image, 'https://a-static.mlcdn.com.br/500x500/carrinho/loja/bb22cc33/def.jpg');
  assert.equal(out[1].rating, null);
  // nomes alternativos: sku/name/link/price numérico/listPrice
  assert.equal(out[2].sourceId, 'zz99');
  assert.equal(out[2].title, 'Mamadeira Sintetica 240ml');
  assert.equal(out[2].price, 25.5);
  assert.equal(out[2].listPrice, 30);
  assert.equal(out[2].path, 'mamadeira-sintetica-240ml/p/zz99/bb/mama/');
});

test('Magalu normalize: diferença Pix x cartão não vira desconto; entradas inválidas não lançam', () => {
  const p = magalu.normalize({ id: '1', title: 't', path: 'a/p/1/', price: { bestPrice: '90.00', fullPrice: '100.00', price: '100.00' } });
  assert.equal(p.price, 90);
  assert.equal(p.listPrice, 100); // "price" é tratado como preço "de" (suposição documentada no adaptador)
  const q = magalu.normalize({ id: '1', title: 't', path: 'a/p/1/', price: { bestPrice: '90.00', fullPrice: '100.00' } });
  assert.equal(q.listPrice, null);
  for (const v of [null, undefined, 'x', [], {}, { id: '1', title: 't' }, { id: '1', title: 't', price: 10 },
    { id: '1', title: 't', price: 10, url: 'https://evil.example/x' }, { id: '1', title: 't', price: 'grátis', path: 'a' }])
    assert.equal(magalu.normalize(v), null);
});

test('Magalu parseHtml: sem __NEXT_DATA__ ou JSON quebrado -> PARSE; sem produtos -> []', () => {
  assert.throws(() => magalu.parseHtml('<html><body>nada</body></html>'), (e) => e.code === 'PARSE');
  assert.throws(() => magalu.parseHtml('<script id="__NEXT_DATA__">{quebrado</script>'), (e) => e.code === 'PARSE');
  assert.throws(() => magalu.parseHtml(null), (e) => e.code === 'PARSE');
  assert.deepEqual(magalu.parseHtml("<script id='__NEXT_DATA__' type='application/json'>{\"props\":{}}</script>"), []);
});

test('Magalu findProducts: estrutura cíclica/profunda não trava', () => {
  const a = { list: [{ id: 1, title: 'x', price: 5, path: 'p' }] };
  a.self = a;
  assert.equal(magalu.findProducts(a).length, 1);
  assert.equal(magalu.findProducts(null), null);
});

test('Magalu search: 403 (Akamai) -> BLOCKED; 429 -> BLOCKED; 500 -> HTTP', async () => {
  mockFetch(() => ({ status: 403, body: '<html><title>Magazine Luiza | Não é possível acessar a página</title>' }));
  await rejectsWithCode(magalu.search({ query: 'fralda' }), 'BLOCKED');
  assert.equal(calls[0].url, 'https://www.magazineluiza.com.br/busca/fralda/');
  assert.doesNotMatch(calls[0].headers['User-Agent'], /Mozilla|Chrome|Safari/, 'User-Agent não deve se passar por navegador');
  mockFetch(() => ({ status: 429, body: '' }));
  await rejectsWithCode(magalu.search({ query: 'x' }), 'BLOCKED');
  mockFetch(() => ({ status: 500, body: '' }));
  await rejectsWithCode(magalu.search({ query: 'x' }), 'HTTP');
});

test('Magalu search: página de bloqueio servida com HTTP 200 -> BLOCKED', async () => {
  mockFetch(() => ({ status: 200, body: '<html><link href="https://wx.mlcdn.com.br/akamai-bot/css/styles-v0.css"></html>' }));
  await rejectsWithCode(magalu.search({ query: 'x' }), 'BLOCKED');
});

test('Magalu search: 200 com fixture SINTÉTICO -> produtos normalizados, respeita limit', async () => {
  mockFetch(() => ({ status: 200, body: fx('magalu-busca-sintetico.html') }));
  const items = await magalu.search({ query: 'fralda g', limit: 2 });
  assert.equal(calls[0].url, 'https://www.magazineluiza.com.br/busca/fralda+g/');
  assert.equal(items.length, 2);
  assert.ok(items.every((p) => p.source === 'magalu' && p.price > 0 && p.url.startsWith('https://www.magazineluiza.com.br/')));
});
