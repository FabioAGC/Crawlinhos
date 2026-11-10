// Testes da coleta Amazon: extractInPage roda num Chromium real (Playwright) sobre um recorte
// de cards reais da busca "fralda pampers"; normalize/parseCount/parseBRL são unitários.
// Rode com: NODE_PATH=$(npm root -g) node --test test/amazon.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const amz = require('../src/sources/amazon');
const { parseBRL } = require('../src/util');

let chromium = null;
try {
  ({ chromium } = require('playwright'));
} catch {}

const FIXTURE = path.join(__dirname, 'fixtures/amazon-busca-fralda.html');

// Card sintético no formato de moda/roupas (dois <h2>: marca e título) e card patrocinado da grade.
// Não é HTML real: monta só o que extractInPage lê.
const SYNTHETIC = `<!doctype html><html><body>
<div data-component-type="s-search-result" data-asin="BSYNTHROUP" class="s-result-item">
  <div data-cy="title-recipe">
    <h2 class="a-size-mini"><span>Gerber</span></h2>
    <a href="/dp/BSYNTHROUP"><h2 aria-label="Kit 5 Bodies Bebê Manga Curta Algodão"><span>Kit 5 Bodies Bebê Manga Curta Algodão</span></h2></a>
  </div>
  <img class="s-image" src="https://m.media-amazon.com/images/I/abc._AC_UL320_.jpg" alt="x">
  <div data-cy="reviews-block"><i><span class="a-icon-alt">4,8 de 5 estrelas</span></i>
    <a href="/dp/BSYNTHROUP#customerReviews"><span>(60,5 mil)</span></a></div>
  <div data-cy="price-recipe"><span class="a-price"><span class="a-offscreen">R$ 1.162,99</span></span></div>
</div>
<div data-component-type="s-search-result" data-asin="BSYNTHSPON" class="s-result-item">
  <a href="/sspa/click?x=1"><h2 aria-label="Anúncio patrocinado – Shampoo Bebê 400ml"><span>Shampoo Bebê 400ml</span></h2></a>
  <div data-cy="price-recipe"><span class="a-price"><span class="a-offscreen">R$ 19,90</span></span></div>
</div>
</body></html>`;

async function extract(html) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ javaScriptEnabled: false });
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    return await page.evaluate(amz.extractInPage);
  } finally {
    await browser.close();
  }
}

test('extractInPage + normalize no recorte real da busca', { skip: !chromium && 'playwright indisponível (exporte NODE_PATH=$(npm root -g))' }, async (t) => {
  const raw = await extract(fs.readFileSync(FIXTURE, 'utf8'));
  const by = Object.fromEntries(raw.map((r) => [r.asin, r]));
  const norm = (a) => amz.normalize(by[a]);

  await t.test('só cards da grade (carrossel patrocinado fica de fora)', () => {
    assert.equal(raw.length, 10);
    assert.ok(!('B0DDTZD5BS' in by)); // card do carrossel "Anúncio patrocinado"
    assert.equal(raw.filter((r) => r.sponsored).length, 0);
  });

  await t.test('preço atual e "De:"; ignora preço por unidade e parcela', () => {
    const p = norm('B0GW44JM3G'); // R$ 98,89 (R$ 0,92/unidade) De: R$ 194,90, 8x de R$ 12,36
    assert.equal(p.price, 98.89);
    assert.equal(p.listPrice, 194.9);
    assert.equal(p.pixPrice, false);
    assert.equal(p.rating, 4.9);
    assert.equal(p.reviews, 129);
    assert.equal(p.title, 'Fralda Pampers Pants Ajuste Total Tamanho M, 108 Unidades');
    assert.match(p.image, /\._AC_SL500_\.jpg$/);
    assert.equal(p.url, 'https://www.amazon.com.br/dp/B0GW44JM3G');
  });

  await t.test('reviews em "mil"', () => {
    assert.equal(norm('B08K4L452V').reviews, 6600);
    assert.equal(norm('B08K4L37HD').reviews, 10800);
  });

  await t.test('sem oferta em destaque / indisponível -> descartado', () => {
    assert.equal(norm('B07GMCX7P4'), null); // "Nenhuma opção de compra em destaque R$ 70,99 (10 ofertas)"
    assert.equal(norm('B07GQB96J4'), null); // "Não disponível."
  });

  await t.test('"Mais opções de compra" e multi-oferta não substituem o preço principal', () => {
    assert.equal(norm('B07X4GVF9H').price, 92.9); // não R$ 83,17 de outros vendedores
    const p = norm('B08K4L37HD'); // bloco multi-offer tem R$ 170,10 / 184,90
    assert.equal(p.price, 154.9);
    assert.equal(p.listPrice, 181.64);
  });

  await t.test('preço só no Pix: riscado = preço no cartão, não é desconto', () => {
    const p = norm('B086DR4Q6Q'); // R$ 114,11 riscado R$ 146,23 à vista no Pix ou 4x de R$ 30,03
    assert.equal(p.price, 114.11);
    assert.equal(p.pixPrice, true);
    assert.equal(p.cardPrice, 120.12);
    assert.equal(p.listPrice, 146.23); // 146,23 > 120,12 no cartão: aqui há desconto de verdade
    const q = norm('B0CTHYB7T6'); // R$ 47,77 riscado R$ 50,29 no Pix; 2x de R$ 25,14 = 50,28
    assert.equal(q.price, 47.77);
    assert.equal(q.listPrice, null);
    assert.equal(q.cardPrice, 50.28);
  });

  await t.test('sem "De:" -> listPrice null', () => {
    assert.equal(norm('B0DFQK6FS3').listPrice, null);
  });
});

test('extractInPage: título de moda (2 h2) e patrocinado na grade', { skip: !chromium && 'playwright indisponível' }, async () => {
  const raw = await extract(SYNTHETIC);
  const [roupa, spon] = raw.map(amz.normalize);
  assert.equal(roupa.title, 'Gerber Kit 5 Bodies Bebê Manga Curta Algodão');
  assert.equal(roupa.reviews, 60500);
  assert.equal(roupa.price, 1162.99);
  assert.equal(spon.sponsored, true);
  assert.equal(spon.title, 'Shampoo Bebê 400ml');
});

test('normalize: casos de borda', () => {
  const base = { asin: 'B000000001', title: 'X', price: 'R$ 10,00', list: '', image: '', ratingTxt: '', reviewsTxt: '' };
  assert.equal(amz.normalize({ ...base, price: '' }), null);
  assert.equal(amz.normalize({ ...base, title: '' }), null);
  assert.equal(amz.normalize({ ...base, list: 'R$ 9,00' }).listPrice, null); // "De:" menor
  assert.equal(amz.normalize({ ...base, list: 'R$ 100,00' }).listPrice, null); // 90% off = erro de leitura
  assert.equal(amz.normalize({ ...base, list: 'R$ 20,00' }).listPrice, 20);
  // Pix sem parcela exibida: riscado só ~5% acima é o preço no cartão
  assert.equal(amz.normalize({ ...base, pix: true, list: 'R$ 10,53' }).listPrice, null);
  assert.equal(amz.normalize({ ...base, pix: true, list: 'R$ 15,00' }).listPrice, 15);
  assert.equal(amz.normalize({ ...base, title: 'Anúncio patrocinado – Fralda  P' }).title, 'Fralda P');
  assert.equal(amz.normalize({ ...base, brand: 'Genérico', title: 'Body Bebê' }).title, 'Body Bebê');
  assert.equal(amz.normalize({ ...base, brand: 'Gerber', title: 'Body Gerber Bebê' }).title, 'Body Gerber Bebê');
  assert.equal(amz.normalize({ ...base, ratingTxt: '4,5 de 5 estrelas' }).rating, 4.5);
  assert.equal(amz.normalize(base).rating, null);
  assert.equal(amz.normalize(base).reviews, null);
});

test('parseCount', () => {
  assert.equal(amz.parseCount('(129) '), 129);
  assert.equal(amz.parseCount('(1.234)'), 1234);
  assert.equal(amz.parseCount('(7,2 mil)'), 7200);
  assert.equal(amz.parseCount('(15 mil)'), 15000);
  assert.equal(amz.parseCount('1,1 mi'), 1100000);
  assert.equal(amz.parseCount(''), null);
  assert.equal(amz.parseCount(undefined), null);
});

test('parseBRL', () => {
  assert.equal(parseBRL('R$ 1.234,56'), 1234.56);
  assert.equal(parseBRL('R$ 98,89'), 98.89);
  assert.equal(parseBRL('1234.56'), 1234.56);
  assert.equal(parseBRL('1.234'), 1234);
  assert.equal(parseBRL(12.5), 12.5);
  assert.equal(parseBRL('R$ 0,00'), null);
  assert.equal(parseBRL(''), null);
  assert.equal(parseBRL(null), null);
  assert.equal(parseBRL(NaN), null);
});

test('isBlockedPage: interstitial e página de erro', () => {
  assert.equal(amz.isBlockedPage('<!-- api-services-support@amazon.com --> Continuar comprando'), true);
  assert.equal(amz.isBlockedPage('<title>Amazon.com.br Algo deu errado</title>'), true);
  assert.equal(amz.isBlockedPage('<div data-component-type="s-search-result"></div> Algo deu errado'), false);
});
