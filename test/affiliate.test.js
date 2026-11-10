/** Testes de src/affiliate.js — sem rede. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { affiliateLink } = require('../src/affiliate');

// ---------------------------------------------------------------- Amazon
test('Amazon: adiciona tag e linkCode', () => {
  const r = affiliateLink({ source: 'amazon', url: 'https://www.amazon.com.br/dp/B0ABC12345' }, { AMAZON_TAG: 'radar-20' });
  assert.deepEqual(r, { url: 'https://www.amazon.com.br/dp/B0ABC12345?tag=radar-20&linkCode=ogi', tagged: true });
});

test('Amazon: URL já com query preserva parâmetros e substitui tag de terceiros', () => {
  const r = affiliateLink({ source: 'amazon', url: 'https://www.amazon.com.br/dp/B0ABC12345?th=1&tag=outro-20#x' }, { AMAZON_TAG: 'radar-20' });
  const u = new URL(r.url);
  assert.equal(u.searchParams.get('th'), '1');
  assert.deepEqual(u.searchParams.getAll('tag'), ['radar-20']);
  assert.equal(r.tagged, true);
});

test('Amazon: tag ausente, de exemplo, com espaço/aspas ou inválida', () => {
  const p = { source: 'amazon', url: 'https://www.amazon.com.br/dp/B0ABC12345' };
  for (const tag of [undefined, '', '   ', 'seutag-20', 'tag com espaço', 'a&b=c'])
    assert.deepEqual(affiliateLink(p, { AMAZON_TAG: tag }), { url: p.url, tagged: false }, String(tag));
  assert.equal(affiliateLink(p, { AMAZON_TAG: ' "radar-20" ' }).url, 'https://www.amazon.com.br/dp/B0ABC12345?tag=radar-20&linkCode=ogi');
  assert.equal(affiliateLink(p, { AMAZON_TAG: 'radar-20  # comentario' }).tagged, true);
});

test('Amazon: URL inválida ou de outro domínio não lança e sai sem tag', () => {
  for (const url of ['nao é url', '', undefined, null, 'javascript:alert(1)', 'https://evil.example/dp/1'])
    assert.equal(affiliateLink({ source: 'amazon', url }, { AMAZON_TAG: 'radar-20' }).tagged, false);
});

// ---------------------------------------------------------------- Mercado Livre
const mlUrl = 'https://produto.mercadolivre.com.br/MLB-1111111111-fralda-infantil-_JM';

test('ML: template com {url} remove query/fragmento da URL do produto', () => {
  const r = affiliateLink({ source: 'mercadolivre', url: `${mlUrl}?searchVariation=1&position=2#reviews` },
    { ML_AFFILIATE_TEMPLATE: '{url}?matt_tool=12345678&matt_word=radar' });
  assert.deepEqual(r, { url: `${mlUrl}?matt_tool=12345678&matt_word=radar`, tagged: true });
});

test('ML: template com {url_enc} (redirecionador) codifica a URL', () => {
  const r = affiliateLink({ source: 'mercadolivre', url: mlUrl },
    { ML_AFFILIATE_TEMPLATE: 'https://exemplo-redirect.test/r?id=abc&url={url_enc}' });
  assert.equal(r.tagged, true);
  assert.equal(new URL(r.url).searchParams.get('url'), mlUrl);
});

test('ML: "$&" e similares na URL não são interpretados pelo replace', () => {
  const url = 'https://produto.mercadolivre.com.br/MLB-1-a$&b$1-_JM';
  const r = affiliateLink({ source: 'mercadolivre', url }, { ML_AFFILIATE_TEMPLATE: '{url}?matt_tool=1' });
  assert.equal(r.url, `${new URL(url).toString()}?matt_tool=1`);
});

test('ML: template ausente, com SEU_TOOL_ID, sem placeholder, ou URL inválida -> sem tag', () => {
  const p = { source: 'mercadolivre', url: mlUrl };
  for (const tpl of [undefined, '', '{url}?matt_tool=SEU_TOOL_ID&matt_word=radar', 'https://x.test/sem-placeholder'])
    assert.deepEqual(affiliateLink(p, { ML_AFFILIATE_TEMPLATE: tpl }), { url: mlUrl, tagged: false }, String(tpl));
  assert.equal(affiliateLink({ source: 'mercadolivre', url: 'lixo' }, { ML_AFFILIATE_TEMPLATE: '{url}?matt_tool=1' }).tagged, false);
});

// ---------------------------------------------------------------- Shopee
test('Shopee: usa offerLink da API; sem offerLink ou inválido -> URL do produto sem tag', () => {
  const base = { source: 'shopee', url: 'https://shopee.com.br/product/1/2' };
  assert.deepEqual(affiliateLink({ ...base, affiliateUrl: 'https://s.shopee.com.br/ABC123' }, {}), { url: 'https://s.shopee.com.br/ABC123', tagged: true });
  for (const affiliateUrl of [undefined, null, '', 'not a url', 'javascript:alert(1)'])
    assert.deepEqual(affiliateLink({ ...base, affiliateUrl }, {}), { url: base.url, tagged: false });
});

// ---------------------------------------------------------------- Magalu
const mgPath = 'fralda-infantil-g/p/234567801/me/fral/';

test('Magalu: magazinevoce.com.br/magazine{LOJA}/{path}', () => {
  const r = affiliateLink({ source: 'magalu', url: `https://www.magazineluiza.com.br/${mgPath}`, path: mgPath }, { MAGALU_STORE: 'radarbebe' });
  assert.deepEqual(r, { url: `https://www.magazinevoce.com.br/magazineradarbebe/${mgPath}`, tagged: true });
});

test('Magalu: MAGALU_STORE aceita "magazineX" e a URL inteira da loja', () => {
  const p = { source: 'magalu', url: `https://www.magazineluiza.com.br/${mgPath}`, path: mgPath };
  for (const store of ['magazineradarbebe', 'https://www.magazinevoce.com.br/magazineradarbebe/', ' radarbebe '])
    assert.equal(affiliateLink(p, { MAGALU_STORE: store }).url, `https://www.magazinevoce.com.br/magazineradarbebe/${mgPath}`, store);
});

test('Magalu: sem path usa o caminho da URL; query/fragmento descartados', () => {
  const r = affiliateLink({ source: 'magalu', url: `https://www.magazineluiza.com.br/${mgPath}?seller_id=x#y` }, { MAGALU_STORE: 'radarbebe' });
  assert.equal(r.url, `https://www.magazinevoce.com.br/magazineradarbebe/${mgPath}`);
});

test('Magalu: acentos/espaços codificados uma única vez', () => {
  const r1 = affiliateLink({ source: 'magalu', url: 'x', path: 'fralda bebê/p/1/' }, { MAGALU_STORE: 'loja' });
  assert.equal(r1.url, 'https://www.magazinevoce.com.br/magazineloja/fralda%20beb%C3%AA/p/1/');
  const r2 = affiliateLink({ source: 'magalu', url: 'x', path: 'fralda%20beb%C3%AA/p/1/' }, { MAGALU_STORE: 'loja' });
  assert.equal(r2.url, r1.url);
});

test('Magalu: loja ausente/inválida, path ausente, path com ".." ou URL de outro domínio -> sem tag', () => {
  const p = { source: 'magalu', url: `https://www.magazineluiza.com.br/${mgPath}`, path: mgPath };
  for (const store of [undefined, '', 'loja/../x', 'loja com espaço'])
    assert.equal(affiliateLink(p, { MAGALU_STORE: store }).tagged, false, String(store));
  assert.equal(affiliateLink({ source: 'magalu', url: 'https://evil.example/x/p/1' }, { MAGALU_STORE: 'loja' }).tagged, false);
  assert.equal(affiliateLink({ source: 'magalu', url: 'lixo' }, { MAGALU_STORE: 'loja' }).tagged, false);
  assert.equal(affiliateLink({ source: 'magalu', url: 'x', path: '../../admin' }, { MAGALU_STORE: 'loja' }).tagged, false);
});

// ---------------------------------------------------------------- geral
test('affiliateLink nunca lança: produto/env nulos, fonte desconhecida, "__proto__"', () => {
  assert.deepEqual(affiliateLink(null, {}), { url: '', tagged: false });
  assert.deepEqual(affiliateLink(undefined, undefined), { url: '', tagged: false });
  assert.deepEqual(affiliateLink({ source: 'outra', url: 'https://x.test/' }, {}), { url: 'https://x.test/', tagged: false });
  assert.deepEqual(affiliateLink({ source: '__proto__', url: 'https://x.test/' }, {}), { url: 'https://x.test/', tagged: false });
  assert.deepEqual(affiliateLink({ source: 'amazon', url: 'https://www.amazon.com.br/dp/1' }, null), { url: 'https://www.amazon.com.br/dp/1', tagged: false });
});
