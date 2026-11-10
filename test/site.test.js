/**
 * Testes do site gerado (src/build.js + temas + src/client.js) com Playwright.
 * Faz o build num diretório temporário (RADAR_DATA_DIR / RADAR_DIST_DIR) a partir dos dados reais
 * de data/products + alguns produtos de borda injetados, sobe src/server.js numa porta efêmera e
 * navega com o Chromium. Requisições externas (fontes, imagens da Amazon) são bloqueadas: o teste
 * não depende de rede e, de quebra, exercita o fallback de imagem quebrada em todos os cards.
 *
 * Requer o pacote playwright (NODE_PATH=$(npm root -g)) e o Chromium já instalado.
 */
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-site-'));
const DATA = path.join(TMP, 'data');
const DIST = path.join(TMP, 'dist');
process.env.RADAR_DATA_DIR = DATA;
process.env.RADAR_DIST_DIR = DIST;
delete process.env.LINK_MODE;

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {}

// ---------- fixture: dados reais + produtos de borda ----------
const EDGE = {
  xss: { id: 'amazon:XSS0000001', cat: 'higiene', title: `Sabonete "Puro" <script>window.__xss=1</script> & 'Cia' </h3><img src=x onerror=window.__xss=2>`, price: 12.5, listPrice: 20 },
  milhar: { id: 'amazon:MILHAR0001', cat: 'passeio', title: 'Carrinho de Bebê Travel System Premium', price: 1234.56, listPrice: 2345.67 },
  semOrig: { id: 'amazon:SEMORIG001', cat: 'fraldas', title: 'Fralda Sem Preço Original', price: 49.9, listPrice: null },
  semImg: { id: 'amazon:SEMIMG0001', cat: 'higiene', title: 'Produto sem imagem nenhuma', price: 9.99, listPrice: null, image: null },
  longo: { id: 'amazon:LONGO00001', cat: 'brinquedos', title: 'Brinquedo' + 'Supercalifragilisticexpialidocious'.repeat(5) + ' ' + 'palavra '.repeat(40), price: 99.9, listPrice: 120 },
};
function edgeProduct(e, niche) {
  return {
    id: e.id, niche, cat: e.cat, source: 'amazon', store: 'Amazon', title: e.title, price: e.price, listPrice: e.listPrice,
    discount: e.listPrice ? Math.round((1 - e.price / e.listPrice) * 100) : 0,
    image: 'image' in e ? e.image : 'https://m.media-amazon.com/images/I/inexistente.jpg',
    url: `https://www.amazon.com.br/dp/${e.id.split(':')[1]}`, affiliateUrl: `https://www.amazon.com.br/dp/${e.id.split(':')[1]}?tag=teste-20`,
    affiliateTagged: true, rating: 4.5, reviews: 10, sold: null, age: null, firstSeen: '2026-11-08', isNew: false, priceDropped: false, lowestSeen: false, score: 1,
  };
}
const N = {};
function setupData() {
  for (const niche of ['bebe', 'beleza']) {
    const real = JSON.parse(fs.readFileSync(path.join(ROOT, `data/products/${niche}.json`), 'utf8'));
    const edges = niche === 'bebe' ? Object.values(EDGE).map((e) => edgeProduct(e, niche)) : [edgeProduct({ ...EDGE.milhar, cat: 'perfumes' }, niche)];
    // registro inválido (sem preço / link javascript:) não pode derrubar o build nem virar link
    const broken = [{ id: 'amazon:RUIM', title: 'Sem preço', cat: 'higiene' }, { ...edgeProduct(EDGE.semOrig, niche), id: 'amazon:JSLINK', affiliateUrl: 'javascript:alert(1)', url: 'javascript:alert(1)' }];
    real.products = [...real.products, ...edges, ...broken];
    fs.mkdirSync(path.join(DATA, 'products'), { recursive: true });
    fs.writeFileSync(path.join(DATA, `products/${niche}.json`), JSON.stringify(real));
    N[niche] = real.products.length - broken.length;
  }
  fs.copyFileSync(path.join(ROOT, 'data/status.json'), path.join(DATA, 'status.json'));
}

let server, base, browser;
const WIDTHS = [1440, 1024, 768, 390];

before(async () => {
  setupData();
  require('../src/build').build();
  ({ server } = require('../src/server'));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  if (chromium) browser = await chromium.launch();
});
after(async () => {
  if (browser) await browser.close();
  if (server) server.close();
  fs.rmSync(TMP, { recursive: true, force: true });
});

const IGNORABLE = /Failed to load resource|net::ERR_FAILED|ERR_BLOCKED/;
async function open(niche, width = 1440) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
  await ctx.route('**/*', (route) => (route.request().url().startsWith(base) ? route.continue() : route.abort()));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !IGNORABLE.test(m.text()) && errors.push(m.text()));
  await page.goto(`${base}/${niche}/`, { waitUntil: 'load' });
  return { ctx, page, errors };
}
const visible = (page) => page.$$eval('[data-grid] > .card:not([hidden])', (els) => els.map((e) => ({ ...e.dataset })));
const counts = (page) => page.$$eval('[data-count]', (els) => els.map((e) => +e.textContent));

// ---------- HTML gerado (sem navegador) ----------
describe('HTML gerado', () => {
  for (const niche of ['bebe', 'beleza']) {
    test(`${niche}: estrutura, SEO, JSON-LD e escaping`, () => {
      const html = fs.readFileSync(path.join(DIST, `${niche}/index.html`), 'utf8');
      assert.match(html, /^<!DOCTYPE html>\n<html lang="pt-BR">/);
      assert.equal((html.match(/<h1[\s>]/g) || []).length, 1, 'um <h1>');
      assert.match(html, /<title>[^<]{10,}<\/title>/);
      assert.match(html, /<meta name="description" content="[^"]{30,}">/);
      assert.equal((html.match(/<article class="card"/g) || []).length, N[niche]);
      assert.ok(html.length < 600 * 1024, `página com ${(html.length / 1024) | 0} KB`);
      for (const img of html.match(/<img [^>]*>/g) || []) assert.match(img, / alt="[^"]+"/);
      const ld = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
      assert.equal(ld['@type'], 'ItemList');
      assert.equal(ld.itemListElement.length, Math.min(30, N[niche]));
      for (const [i, it] of ld.itemListElement.entries()) {
        assert.equal(it.position, i + 1);
        assert.match(it.item.offers.price, /^\d+\.\d{2}$/);
        assert.match(it.item.offers.url, /^https:\/\//);
      }
      assert.doesNotMatch(html, /javascript:alert/, 'link javascript: descartado');
      assert.doesNotMatch(html, /RUIM/, 'produto inválido descartado');
      if (niche === 'bebe') {
        assert.doesNotMatch(html, /<script>window\.__xss/);
        assert.match(html, /&lt;script&gt;window\.__xss=1&lt;\/script&gt;/);
      }
    });
  }

  test('imgFallback: três camadas de escape (rótulo com & \' < ")', () => {
    const { imgFallback } = require('../src/build');
    const attr = imgFallback(`O'Neil & "Cia" <b>`);
    const m = attr.match(/^onerror="([^"]*)"$/);
    assert.ok(m, 'atributo sem aspas duplas cruas');
    const js = m[1].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    const fake = { onerror: 1, outerHTML: '' };
    new Function(js).call(fake);
    assert.equal(fake.outerHTML, `<div class="card-ph"><span>O&#39;Neil &amp; &quot;Cia&quot; &lt;b&gt;</span></div>`);
    assert.equal(fake.onerror, null);
  });

  test('LINK_MODE=direct gera o link de afiliado direto', () => {
    const dist2 = path.join(TMP, 'dist-direct');
    execFileSync(process.execPath, [path.join(ROOT, 'src/build.js')], {
      env: { ...process.env, LINK_MODE: 'direct', RADAR_DIST_DIR: dist2, RADAR_DATA_DIR: path.join(TMP, 'data-direct') },
      stdio: 'ignore',
      cwd: ROOT,
      // usa os mesmos produtos do fixture
      ...(fs.cpSync(DATA, path.join(TMP, 'data-direct'), { recursive: true }), {}),
    });
    const html = fs.readFileSync(path.join(dist2, 'bebe/index.html'), 'utf8');
    const hrefs = [...html.matchAll(/<a class="price-r" href="([^"]+)"/g)].map((m) => m[1]);
    assert.equal(hrefs.length, N.bebe);
    for (const h of hrefs) assert.match(h, /^https:\/\/www\.amazon\.com\.br\//);
    assert.ok(hrefs.includes('https://www.amazon.com.br/dp/MILHAR0001?tag=teste-20'));
    // o build padrão não foi afetado
    assert.match(fs.readFileSync(path.join(DIST, 'bebe/index.html'), 'utf8'), /href="\/go\/amazon%3AMILHAR0001"/);
  });
});

// ---------- navegador ----------
describe('navegador', { skip: !chromium && 'playwright indisponível' }, () => {
  for (const niche of ['bebe', 'beleza']) {
    test(`${niche}: filtro por categoria atualiza cards, contadores e estado`, async () => {
      const { ctx, page, errors } = await open(niche);
      assert.equal((await visible(page)).length, N[niche]);
      const btns = await page.$$('[data-cat-btn]');
      assert.ok(btns.length >= 5);
      for (const b of btns) {
        const id = await b.getAttribute('data-cat-btn');
        await b.click();
        const v = await visible(page);
        assert.ok(v.length > 0, id);
        if (id !== 'all') assert.ok(v.every((c) => c.cat === id), id);
        else assert.equal(v.length, N[niche]);
        for (const c of await counts(page)) assert.equal(c, v.length, `contador ${id}`);
        assert.equal(await b.getAttribute('aria-pressed'), 'true');
        assert.equal(await page.$$eval('[data-cat-btn].is-active', (e) => e.length), 1);
      }
      assert.deepEqual(errors, []);
      await ctx.close();
    });

    test(`${niche}: cada ordenação ordena de fato (data-attributes na ordem do DOM)`, async () => {
      const { ctx, page, errors } = await open(niche);
      const cmp = {
        destaque: (a, b) => b.score - a.score, desconto: (a, b) => b.disc - a.disc, menor_preco: (a, b) => a.price - b.price,
        maior_preco: (a, b) => b.price - a.price, popularidade: (a, b) => b.pop - a.pop, recentes: (a, b) => b.first.localeCompare(a.first),
      };
      const ids = await page.$$eval('[data-sort-btn]', (e) => e.map((x) => x.dataset.sortBtn));
      assert.deepEqual(ids.sort(), Object.keys(cmp).sort());
      for (const id of ids) {
        await page.click(`[data-sort-btn="${id}"]`);
        const v = (await visible(page)).map((c) => ({ ...c, price: +c.price, disc: +c.disc, score: +c.score, pop: +c.pop }));
        for (let i = 1; i < v.length; i++) assert.ok(cmp[id](v[i - 1], v[i]) <= 0, `${id}: posição ${i}`);
        assert.equal(await page.getAttribute(`[data-sort-btn="${id}"]`, 'aria-pressed'), 'true');
      }
      assert.deepEqual(errors, []);
      await ctx.close();
    });
  }

  test('busca com e sem acento, maiúsculas, estado vazio e combinação filtro+busca+ordenação', async () => {
    const { ctx, page, errors } = await open('bebe');
    await page.fill('[data-search]', 'bebê');
    const a = await visible(page);
    await page.fill('[data-search]', 'BEBE');
    const b = await visible(page);
    assert.ok(a.length > 0);
    assert.deepEqual(a.map((c) => c.id), b.map((c) => c.id));
    assert.ok(a.every((c) => /beb[eê]/i.test(c.title)));
    assert.equal(await page.$eval('[data-empty]', (e) => e.hidden), true);

    await page.fill('[data-search]', 'zzzqqqxx');
    assert.equal((await visible(page)).length, 0);
    assert.equal(await page.$eval('[data-empty]', (e) => e.hidden), false);
    assert.ok(await page.isVisible('[data-empty]'));
    for (const c of await counts(page)) assert.equal(c, 0);

    await page.fill('[data-search]', '');
    await page.click('[data-cat-btn="higiene"]');
    await page.click('[data-sort-btn="menor_preco"]');
    await page.fill('[data-search]', 'sabonete');
    const v = await visible(page);
    assert.ok(v.length > 0);
    assert.ok(v.every((c) => c.cat === 'higiene' && /sabonete/i.test(c.title)));
    for (let i = 1; i < v.length; i++) assert.ok(+v[i - 1].price <= +v[i].price);
    assert.deepEqual(errors, []);
    await ctx.close();
  });

  test('rodapé: loja e categorias filtram', async () => {
    for (const niche of ['bebe', 'beleza']) {
      const { ctx, page, errors } = await open(niche);
      await page.click('[data-cat-btn]:nth-child(2)');
      await page.click('.foot a[data-store]');
      const store = await page.getAttribute('.foot a[data-store]', 'data-store');
      const v = await visible(page);
      assert.equal(v.length, N[niche]);
      assert.ok(v.every((c) => c.store === store));
      assert.equal(await page.getAttribute('[data-cat-btn="all"]', 'aria-pressed'), 'true');
      assert.ok(!page.url().endsWith('#'), 'link da loja não navega para #');
      for (const l of await page.$$('.foot a[data-cat-link]')) {
        const id = await l.getAttribute('data-cat-link');
        await l.click();
        const w = await visible(page);
        assert.ok(w.length > 0 && w.every((c) => c.cat === id), id);
        assert.equal(await page.getAttribute(`[data-cat-btn="${id}"]`, 'aria-pressed'), 'true');
      }
      assert.deepEqual(errors, []);
      await ctx.close();
    }
  });

  test('links de afiliado: todo card aponta para /go/<id> válido com target e rel', async () => {
    for (const niche of ['bebe', 'beleza']) {
      const { ctx, page } = await open(niche);
      const cards = await page.$$eval('.card', (cs) => cs.map((c) => ({ id: c.dataset.id, links: [...c.querySelectorAll('a')].map((a) => ({ h: a.getAttribute('href'), t: a.target, r: a.rel })) })));
      assert.equal(cards.length, N[niche]);
      for (const c of cards) {
        assert.ok(c.links.length >= 2, c.id);
        for (const l of c.links) {
          assert.equal(l.h, '/go/' + encodeURIComponent(c.id));
          assert.equal(l.t, '_blank');
          assert.equal(l.r, 'sponsored nofollow noopener');
        }
      }
      // amostra: o redirecionador responde 302 para a Amazon
      for (const c of cards.filter((_, i) => i % 25 === 0)) {
        const r = await fetch(base + c.links[0].h, { redirect: 'manual' });
        assert.equal(r.status, 302, c.id);
        assert.match(r.headers.get('location'), /^https:\/\/www\.amazon\.com\.br\//);
      }
      await ctx.close();
    }
  });

  test('cards de borda: XSS no título, preço com milhar, sem preço original, imagem quebrada e ausente', async () => {
    const { ctx, page, errors } = await open('bebe');
    // imagens são lazy: rola até cada card de borda e espera o onerror trocar pelo placeholder
    for (const e of [EDGE.xss, EDGE.semOrig, EDGE.milhar]) {
      await page.locator(`.card[data-id="${e.id}"]`).scrollIntoViewIfNeeded();
      await page.waitForSelector(`.card[data-id="${e.id}"] .card-ph`, { timeout: 10000 });
    }
    assert.equal(await page.evaluate(() => window.__xss), undefined, 'nenhum script do título executou');
    const card = (id) => page.locator(`.card[data-id="${id}"]`);
    assert.equal(await card(EDGE.xss.id).locator('.card-name').innerText(), EDGE.xss.title);
    assert.equal((await card(EDGE.milhar.id).locator('.price-now').textContent()).replace(/\s/g, ' '), 'R$ 1.234,56');
    assert.equal((await card(EDGE.milhar.id).locator('.price-orig').textContent()).replace(/\s/g, ' '), 'R$ 2.345,67');
    assert.equal(await card(EDGE.semOrig.id).locator('.price-orig').count(), 0);
    // imagem quebrada vira placeholder com o rótulo da categoria (rótulo com "&")
    assert.equal(await card(EDGE.xss.id).locator('.card-ph span').textContent(), 'Banho & Higiene');
    assert.equal(await card(EDGE.semImg.id).locator('.card-ph span').textContent(), 'Banho & Higiene');
    assert.equal(await card(EDGE.semOrig.id).locator('.card-ph span').textContent(), 'Fraldas & Lenços');
    assert.deepEqual(errors, []);
    await ctx.close();
  });

  for (const niche of ['bebe', 'beleza'])
    test(`${niche}: sem overflow horizontal em ${WIDTHS.join('/')}px e nada vaza dos cards`, async () => {
      for (const w of WIDTHS) {
        const { ctx, page, errors } = await open(niche, w);
        const r = await page.evaluate(() => {
          const vw = document.documentElement.clientWidth;
          const out = [];
          for (const e of document.querySelectorAll('.radar *')) {
            const b = e.getBoundingClientRect();
            if (!b.width) continue;
            let a = e.parentElement, clipped = false;
            for (; a && a !== document.body; a = a.parentElement) if (getComputedStyle(a).overflowX !== 'visible') { clipped = true; break; }
            if (!clipped && (b.right > vw + 1 || b.left < -1)) out.push(e.className || e.tagName);
          }
          // texto do card não pode passar da largura do card
          for (const c of document.querySelectorAll('.card')) {
            const cb = c.getBoundingClientRect();
            for (const e of c.querySelectorAll('.card-name, .price-row, .card-meta, .card-tax'))
              if (e.getBoundingClientRect().right > cb.right + 1) out.push('card>' + e.className);
          }
          return { sw: document.documentElement.scrollWidth, vw, out: [...new Set(out)].slice(0, 5) };
        });
        assert.ok(r.sw <= r.vw, `${niche}@${w}: scrollWidth ${r.sw} > ${r.vw}`);
        assert.deepEqual(r.out, [], `${niche}@${w}`);
        assert.deepEqual(errors, []);
        await ctx.close();
      }
    });

  test('teclado: Tab alcança filtros com foco visível e Enter filtra', async () => {
    const { ctx, page } = await open('beleza');
    let found = false;
    for (let i = 0; i < 30 && !found; i++) {
      await page.keyboard.press('Tab');
      found = await page.evaluate(() => document.activeElement?.getAttribute('data-cat-btn') === 'perfumes');
    }
    assert.ok(found, 'botão de categoria alcançável por Tab');
    await page.waitForTimeout(400); // fim da transição do tema
    const outline = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
    assert.notEqual(outline, 'none');
    await page.keyboard.press('Enter');
    const v = await visible(page);
    assert.ok(v.length > 0 && v.every((c) => c.cat === 'perfumes'));
    // link da imagem fica fora da ordem de Tab (o título e o CTA já levam à oferta)
    assert.equal(await page.$$eval('.card-img-wrap', (as) => as.every((a) => a.tabIndex === -1)), true);
    await ctx.close();
  });

  test('hub e status renderizam e os links funcionam', async () => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(base + '/');
    assert.equal(await page.locator('h1').count(), 1);
    const hrefs = await page.$$eval('a', (as) => as.map((a) => a.href));
    assert.ok(hrefs.some((h) => h.endsWith('/bebe/')) && hrefs.some((h) => h.endsWith('/beleza/')) && hrefs.some((h) => h.endsWith('/status.html')));
    for (const h of hrefs) assert.equal((await page.request.get(h)).status(), 200, h);
    await page.click('a.hub-card[href="./bebe/"]');
    assert.ok(page.url().endsWith('/bebe/'));
    for (const sel of ['a[href="../beleza/"]', 'a[href="../"]']) assert.equal((await page.request.get(new URL(await page.getAttribute(sel, 'href'), page.url()).href)).status(), 200, sel);
    await page.goto(base + '/status.html');
    assert.ok((await page.locator('table tr').count()) > 1);
    await page.click('a[href="./"]');
    assert.equal(new URL(page.url()).pathname, '/');
    assert.deepEqual(errors, []);
    await ctx.close();
  });
});
