// Testes da pipeline: finalize/score/ageFromTitle/isExcluded/dedupeVariants e run() com fontes falsas
// numa pasta temporária (não toca em data/ do projeto).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const pl = require('../src/pipeline');

const raw = (o = {}) => ({
  source: 'amazon', sourceId: 'B000000001', title: 'Fralda Teste M', price: 50, listPrice: 100,
  url: 'https://www.amazon.com.br/dp/B000000001', rating: 4.8, reviews: 1000, ...o,
});
const ctx = (history, today, niche = 'bebe') => ({ niche, cat: 'fraldas', today, history, env: {} });

test('finalize: desconto e listPrice', () => {
  const h = { __start: '2026-01-01' };
  assert.equal(pl.finalize(raw(), ctx(h, '2026-01-01')).discount, 50);
  const p = pl.finalize(raw({ sourceId: 'B2', listPrice: 40 }), ctx(h, '2026-01-01'));
  assert.equal(p.listPrice, null); // "De:" menor que o preço não vira desconto negativo
  assert.equal(p.discount, 0);
  assert.equal(pl.finalize(raw({ sourceId: 'B3', listPrice: null }), ctx(h, '2026-01-01')).discount, 0);
});

test('finalize: histórico, isNew, priceDropped, lowestSeen', () => {
  const h = { __start: '2026-01-01' };
  let p = pl.finalize(raw(), ctx(h, '2026-01-01'));
  assert.equal(p.isNew, false); // visto no 1º dia não é "novo"
  assert.equal(p.priceDropped, false);
  // mesmo dia: sobrescreve, não duplica
  pl.finalize(raw({ price: 48 }), ctx(h, '2026-01-01'));
  assert.deepEqual(h['amazon:B000000001'].prices, [{ d: '2026-01-01', p: 48 }]);
  p = pl.finalize(raw({ price: 45 }), ctx(h, '2026-01-02'));
  assert.equal(p.priceDropped, true);
  assert.equal(p.isNew, false);
  const n = pl.finalize(raw({ sourceId: 'BNEW' }), ctx(h, '2026-01-02'));
  assert.equal(n.isNew, true);
  assert.equal(pl.finalize(raw({ sourceId: 'BNEW' }), ctx(h, '2026-01-05')).isNew, false);

  // lowestSeen: precisa de 7+ dias e de já ter custado mais
  const h2 = { __start: '2026-01-01' };
  for (let d = 1; d <= 7; d++) p = pl.finalize(raw({ price: 30 }), ctx(h2, `2026-01-0${d}`));
  assert.equal(p.lowestSeen, false, 'preço parado não é "menor preço"');
  const h3 = { __start: '2026-01-01' };
  for (let d = 1; d <= 7; d++) p = pl.finalize(raw({ price: d < 7 ? 40 : 30 }), ctx(h3, `2026-01-0${d}`));
  assert.equal(p.lowestSeen, true);

  // histórico limitado a 90 pontos
  const h4 = { __start: '2025-01-01' };
  const start = Date.parse('2025-01-01');
  for (let i = 0; i < 95; i++) pl.finalize(raw({ price: 10 + i }), ctx(h4, new Date(start + i * 864e5).toISOString().slice(0, 10)));
  assert.equal(h4['amazon:B000000001'].prices.length, 90);
});

test('finalize: idade só no nicho bebe e título normalizado', () => {
  const h = {};
  assert.equal(pl.finalize(raw({ title: 'Chupeta  0-6 Meses ' }), ctx(h, '2026-01-01')).age, '0m+');
  assert.equal(pl.finalize(raw({ title: 'Chupeta 0-6 Meses' }), ctx(h, '2026-01-01', 'beleza')).age, null);
  assert.equal(pl.finalize(raw({ title: 'Chupeta  0-6 Meses ' }), ctx(h, '2026-01-01')).title, 'Chupeta 0-6 Meses');
});

test('score', () => {
  const s = (o) => pl.score({ discount: 0, rating: null, reviews: null, ...o });
  assert.equal(s({}), 8); // só o "neutro" de nota (0,4*0,2)
  assert.equal(s({ discount: 70, rating: 5, reviews: 9999 }), 100);
  assert.equal(s({ discount: 90, rating: 5, reviews: 9999 }), 100); // teto
  assert.ok(s({ discount: -10 }) >= 0);
  // 5,0 com 2 avaliações não vence 4,6 com 5 mil
  assert.ok(s({ rating: 5, reviews: 2 }) < s({ rating: 4.6, reviews: 5000 }));
  assert.ok(s({ discount: 40 }) > s({ discount: 10 }));
});

test('ageFromTitle', () => {
  assert.equal(pl.ageFromTitle('Chupeta Ultra Air 6-18 Meses'), '6m+');
  assert.equal(pl.ageFromTitle('Mamadeira 3m+ 330ml'), '3m+');
  assert.equal(pl.ageFromTitle('Mordedor | +4 Meses'), '4m+');
  assert.equal(pl.ageFromTitle('Mamadeira, A partir de 1 mês, 260ml'), '1m+');
  assert.equal(pl.ageFromTitle('Fralda Recém-Nascido RN 36 un'), '0+');
  // falsos positivos que existiam nos dados coletados
  assert.equal(pl.ageFromTitle('Babá Eletrônica Tela 3.2", Visão Noturna 10M Infravermelha'), null);
  assert.equal(pl.ageFromTitle('Tapete Dupla Face 6mm 1,80x1,20m'), null);
  assert.equal(pl.ageFromTitle('Babá Eletrônica Tela 2.0" 60m de alcance'), null);
});

test('isExcluded: palavra inteira, sem acento/caixa', () => {
  assert.equal(pl.isExcluded('Fralda Geriátrica Bigfral G', ['geriatrica']), true);
  assert.equal(pl.isExcluded('Chupeta Lillo, Cachorro, Bege', ['para cachorro', 'pet']), false);
  assert.equal(pl.isExcluded('Mordedor para Cachorro Pet', ['para cachorro']), true);
  assert.equal(pl.isExcluded('Tapete Tatame EVA', ['tatame']), true);
  assert.equal(pl.isExcluded('Petit Bebê', ['pet']), false);
  assert.equal(pl.isExcluded('Qualquer', []), false);
  assert.equal(pl.isExcluded('Qualquer', undefined), false);
});

test('config/niches.json: estrutura e termos de exclusão', () => {
  const n = JSON.parse(fs.readFileSync(path.join(__dirname, '../config/niches.json'), 'utf8'));
  for (const niche of Object.values(n)) {
    assert.ok(Array.isArray(niche.categories) && niche.categories.length);
    for (const c of niche.categories) {
      assert.ok(c.id && c.label && c.queries.length, c.id);
      if (c.exclude) assert.ok(c.exclude.every((t) => typeof t === 'string' && t.trim()));
      // nenhuma busca pode ser derrubada pelos próprios termos de exclusão
      const ex = [...(niche.exclude || []), ...(c.exclude || [])];
      for (const q of c.queries) assert.equal(pl.isExcluded(q, ex), false, `${c.id}: "${q}"`);
    }
  }
});

test('dedupeVariants', () => {
  const p = (id, title, rating, reviews, cat = 'sono') => ({ id, source: 'amazon', cat, title, rating, reviews });
  const out = pl.dedupeVariants([
    p('a', 'Manta Papi', 4.6, 104), p('b', 'Manta Papi', 4.7, 42), p('c', 'manta papi', 4.6, 56),
    p('d', 'Granado Lavanda', 4.8, 35900), p('e', 'Granado Camomila', 4.8, 35900), p('f', 'Granado Tradicional', 4.8, 35900),
    p('g', 'Manta Papi', 4.6, 104, 'outra'), p('h', 'Sem nota 1', null, null), p('i', 'Sem nota 2', null, null),
  ]);
  assert.deepEqual(out.map((x) => x.id), ['a', 'd', 'e', 'g', 'h', 'i']);
});

test('localDate usa fuso de São Paulo', () => {
  assert.equal(pl.localDate(new Date('2026-11-10T01:30:00Z')), '2026-11-09');
  assert.equal(pl.localDate(new Date('2026-11-10T04:00:00Z')), '2026-11-10');
});

// ---------- run() ponta a ponta, numa pasta temporária ----------

function sandbox(niches, previous) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-test-'));
  fs.mkdirSync(path.join(root, 'config'));
  fs.mkdirSync(path.join(root, 'data/products'), { recursive: true });
  fs.writeFileSync(path.join(root, 'config/niches.json'), JSON.stringify(niches));
  for (const [n, data] of Object.entries(previous || {}))
    fs.writeFileSync(path.join(root, `data/products/${n}.json`), JSON.stringify(data));
  const read = (f) => JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'));
  return { root, read, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

const NICHES = {
  bebe: {
    exclude: ['geriatrica'],
    categories: [
      { id: 'fraldas', label: 'Fraldas', queries: ['fralda'] },
      { id: 'sono', label: 'Sono', queries: ['manta'] },
    ],
  },
};

function fakeSource(byQuery) {
  return {
    label: 'Amazon',
    calls: [],
    async search({ query }) {
      this.calls.push(query);
      const r = byQuery[query];
      if (r instanceof Error) throw r;
      return r || [];
    },
    close() {},
  };
}
const err = (code) => Object.assign(new Error(code), { code });

test('run: coleta normal, exclusão, duplicata entre buscas, item malformado', async () => {
  const sb = sandbox(NICHES);
  try {
    const amazon = fakeSource({
      fralda: [raw({ sourceId: 'A1' }), raw({ sourceId: 'A2', title: 'Fralda Geriátrica G' }), { source: 'amazon', sourceId: 'A3', title: 'sem preço' }],
      manta: [raw({ sourceId: 'A1' }), raw({ sourceId: 'A4', title: 'Manta Bebê' })],
    });
    const st = await pl.run({ root: sb.root, sources: { amazon }, today: '2026-01-02' });
    const out = sb.read('data/products/bebe.json');
    assert.deepEqual(out.products.map((p) => p.id).sort(), ['amazon:A1', 'amazon:A4']);
    assert.equal(out.products.find((p) => p.id === 'amazon:A1').cat, 'fraldas'); // 1ª categoria vence
    assert.equal(st.niches.bebe.sources.amazon.status, 'OK');
    const hist = sb.read('data/history.json');
    assert.ok(!hist['amazon:A2'], 'item excluído não entra no histórico');
    assert.ok(!hist['amazon:A3']);
  } finally {
    sb.cleanup();
  }
});

test('run: coleta vazia mantém vitrine anterior', async () => {
  const prev = { niche: 'bebe', generatedAt: '2026-01-01T10:00:00Z', products: [{ id: 'amazon:OLD', source: 'amazon', cat: 'fraldas', title: 'x' }] };
  const sb = sandbox(NICHES, { bebe: prev });
  try {
    const amazon = fakeSource({});
    const st = await pl.run({ root: sb.root, sources: { amazon }, today: '2026-01-02' });
    assert.deepEqual(sb.read('data/products/bebe.json'), prev);
    assert.equal(st.niches.bebe.stale, true);
    assert.equal(st.niches.bebe.sources.amazon.status, 'EMPTY');
  } finally {
    sb.cleanup();
  }
});

test('run: bloqueio no meio reaproveita categorias que falharam (e só elas)', async () => {
  const prev = {
    niche: 'bebe', generatedAt: '2026-01-01T10:00:00Z',
    products: [
      { id: 'amazon:OLDF', source: 'amazon', cat: 'fraldas', title: 'velha fralda', score: 10 },
      { id: 'amazon:OLDS', source: 'amazon', cat: 'sono', title: 'velha manta', score: 10 },
    ],
  };
  const sb = sandbox(NICHES, { bebe: prev });
  try {
    const amazon = fakeSource({ fralda: [raw({ sourceId: 'A1' })], manta: err('BLOCKED') });
    const st = await pl.run({ root: sb.root, sources: { amazon }, today: '2026-01-02' });
    const out = sb.read('data/products/bebe.json');
    const ids = out.products.map((p) => p.id).sort();
    assert.deepEqual(ids, ['amazon:A1', 'amazon:OLDS']);
    const old = out.products.find((p) => p.id === 'amazon:OLDS');
    assert.equal(old.stale, true);
    assert.equal(old.staleSince, '2026-01-01');
    assert.equal(st.niches.bebe.sources.amazon.status, 'BLOCKED');
    assert.equal(st.niches.bebe.sources.amazon.count, 1);
    assert.equal(st.niches.bebe.sources.amazon.stale, 1);
  } finally {
    sb.cleanup();
  }
});

test('run: produto reaproveitado expira após 3 dias', async () => {
  const prev = {
    niche: 'bebe', generatedAt: '2026-01-05T10:00:00Z',
    products: [{ id: 'amazon:OLDS', source: 'amazon', cat: 'sono', title: 'velha', stale: true, staleSince: '2026-01-01' }],
  };
  const sb = sandbox(NICHES, { bebe: prev });
  try {
    const amazon = fakeSource({ fralda: [raw({ sourceId: 'A1' })], manta: err('PARSE') });
    const st = await pl.run({ root: sb.root, sources: { amazon }, today: '2026-01-05' });
    assert.deepEqual(sb.read('data/products/bebe.json').products.map((p) => p.id), ['amazon:A1']);
    assert.equal(st.niches.bebe.sources.amazon.status, 'PARTIAL');
  } finally {
    sb.cleanup();
  }
});

test('run: sem credencial desativa a fonte e não quebra as outras; close com erro não impede gravar', async () => {
  const sb = sandbox(NICHES);
  try {
    const amazon = fakeSource({ fralda: [raw({ sourceId: 'A1' })] });
    amazon.close = async () => { throw new Error('browser já fechado'); };
    const shopee = fakeSource({ fralda: err('NO_CREDENTIALS') });
    const st = await pl.run({ root: sb.root, sources: { amazon, shopee }, today: '2026-01-02' });
    assert.deepEqual(shopee.calls, ['fralda']); // não insiste nas próximas buscas
    assert.equal(st.niches.bebe.sources.shopee.status, 'NO_CREDENTIALS');
    assert.equal(st.niches.bebe.sources.amazon.status, 'OK');
    assert.ok(sb.read('data/history.json')['amazon:A1']);
    assert.ok(sb.read('data/status.json').niches.bebe);
  } finally {
    sb.cleanup();
  }
});

test('run --niche preserva status dos outros nichos', async () => {
  const niches = { ...NICHES, beleza: { categories: [{ id: 'x', label: 'X', queries: ['perfume'] }] } };
  const sb = sandbox(niches);
  try {
    fs.writeFileSync(path.join(sb.root, 'data/status.json'), JSON.stringify({ niches: { beleza: { total: 7 } } }));
    const amazon = fakeSource({ fralda: [raw({ sourceId: 'A1' })] });
    await pl.run({ root: sb.root, sources: { amazon }, niche: 'bebe', today: '2026-01-02' });
    const st = sb.read('data/status.json');
    assert.equal(st.niches.beleza.total, 7);
    assert.equal(st.niches.bebe.total, 1);
    assert.deepEqual(amazon.calls, ['fralda', 'manta']);
  } finally {
    sb.cleanup();
  }
});
