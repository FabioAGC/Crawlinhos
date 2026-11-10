/**
 * Amazon.com.br — busca pública renderizada em navegador (Playwright).
 * Em produção, troque por PA-API / Creators API assim que a conta de Associados
 * for aprovada (exige vendas qualificadas): mesmo contrato de saída.
 */
const { SourceError, parseBRL, sleep } = require('../util');

const BASE = 'https://www.amazon.com.br';
let browser = null;
let context = null;

async function init() {
  if (context) return;
  const { chromium } = require('playwright');
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  browser = await chromium.launch({ proxy: proxy ? { server: proxy } : undefined });
  context = await browser.newContext({ locale: 'pt-BR', viewport: { width: 1366, height: 900 } });
  // Imagens, fontes e mídia não são necessárias para extrair os dados.
  await context.route('**/*', (route) =>
    ['image', 'font', 'media'].includes(route.request().resourceType()) ? route.abort() : route.continue()
  );
}

async function close() {
  if (browser) await browser.close();
  browser = context = null;
}

/**
 * Roda dentro da página: extrai os cards de resultado. Mantida pura (sem closures) para ser
 * testável com fixture via page.evaluate.
 */
function extractInPage() {
  const out = [];
  for (const el of document.querySelectorAll('div[data-component-type="s-search-result"][data-asin]')) {
    const asin = el.getAttribute('data-asin');
    if (!asin) continue;
    const sponsored = !!el.querySelector('.puis-sponsored-label-text, [aria-label*="atrocinado"], a[href*="/sspa/"]') ||
      /AdHolder/.test(el.className);
    // Em moda/roupas o card tem dois <h2>: o primeiro é só a marca ("Gerber", "Genérico") e o
    // segundo é o título. Usa o h2 com aria-label; senão, o de texto mais longo.
    const h2s = [...el.querySelectorAll('h2')].map((h) => ({
      label: (h.getAttribute('aria-label') || '').trim(),
      text: (h.textContent || '').trim(),
    }));
    const best = h2s.find((h) => h.label) || h2s.slice().sort((a, b) => b.text.length - a.text.length)[0];
    const title = (best && (best.label || best.text)) || el.querySelector('img.s-image')?.getAttribute('alt') || '';
    const brand = h2s.length > 1 && h2s[0] !== best ? h2s[0].text : '';
    // Só o bloco de preço principal: ignora "Mais opções de compra" e ofertas secundárias.
    const box = el.querySelector('[data-cy="price-recipe"]') || el;
    const price = box.querySelector('.a-price:not(.a-text-price) .a-offscreen')?.textContent || '';
    // Só o preço riscado ("De: R$ X") é preço original; .a-text-price sem data-a-strike é preço
    // por unidade/litro ou valor da parcela.
    const list = box.querySelector('.a-price.a-text-price[data-a-strike="true"] .a-offscreen')?.textContent || '';
    const boxTxt = box.textContent || '';
    // "R$ X à vista no Pix ou em até Nx de R$ Y": X só vale no Pix; N*Y é o preço no cartão.
    const pix = /à vista no Pix/i.test(boxTxt);
    const inst = boxTxt.match(/em até\s*(\d+)x de\s*R\$\s*([\d.]+,\d{2})/i);
    const image = el.querySelector('img.s-image')?.getAttribute('src') || '';
    const rev = el.querySelector('[data-cy="reviews-block"]') || el;
    const ratingTxt = rev.querySelector('.a-icon-alt')?.textContent || '';
    const reviewsTxt =
      el.querySelector('a[href*="#customerReviews"] span, [data-cy="reviews-block"] .s-underline-text')?.textContent || '';
    const boughtTxt = el.querySelector('[data-cy="reviews-block"] .a-color-secondary')?.textContent || '';
    out.push({
      asin, sponsored, title: title.trim(), brand, price, list, pix,
      installments: inst ? inst[1] : '', installmentTxt: inst ? inst[2] : '',
      image, ratingTxt, reviewsTxt, boughtTxt,
    });
  }
  return out;
}

/** "(1.234)" -> 1234 | "(6,6 mil)" -> 6600 | "1 mi" -> 1000000 | "" -> null */
function parseCount(txt) {
  const s = String(txt || '').toLowerCase();
  const m = s.match(/(\d[\d.]*(?:,\d+)?)\s*(mil|mi)?/);
  if (!m) return null;
  if (m[2]) return Math.round(parseFloat(m[1].replace(/\./g, '').replace(',', '.')) * (m[2] === 'mil' ? 1e3 : 1e6));
  return parseInt(m[1].replace(/\./g, ''), 10) || null;
}

function normalize(raw) {
  const price = parseBRL(raw.price);
  if (!raw.asin || !raw.title || !price) return null; // sem preço = indisponível / sem oferta em destaque
  let listPrice = parseBRL(raw.list);
  // Desconto acima de 80% quase sempre é erro de leitura; melhor não exibir do que exibir desconto falso.
  if (!(listPrice && listPrice > price && price / listPrice >= 0.2)) listPrice = null;
  // Preço no Pix: o riscado costuma ser só o preço no cartão (5% a mais), não um "De:" promocional.
  // Só mantém o riscado se ele for maior que o preço parcelado (ou, sem parcela exibida, > ~5,5%).
  const cardPrice = raw.pix && raw.installments
    ? Math.round(parseInt(raw.installments, 10) * (parseBRL(raw.installmentTxt) || 0) * 100) / 100 || null
    : null;
  if (raw.pix && listPrice) {
    if (cardPrice ? listPrice <= cardPrice * 1.01 : price / listPrice >= 0.945) listPrice = null;
  }
  const rating = parseFloat((String(raw.ratingTxt || '').match(/(\d[.,]\d)/) || [])[1]?.replace(',', '.')) || null;
  let title = raw.title.replace(/^Anúncio patrocinado\s*[–-]\s*/i, '').replace(/\s+/g, ' ').trim();
  const brand = (raw.brand || '').trim();
  if (brand && !/^gen[eé]rico$/i.test(brand) && !title.toLowerCase().includes(brand.toLowerCase())) title = `${brand} ${title}`;
  return {
    source: 'amazon',
    sourceId: raw.asin,
    title,
    price,
    listPrice,
    pixPrice: !!raw.pix,
    cardPrice,
    image: String(raw.image || '').replace(/\._AC_[^.]+_\./, '._AC_SL500_.'),
    url: `${BASE}/dp/${raw.asin}`,
    rating,
    reviews: parseCount(raw.reviewsTxt),
    sponsored: !!raw.sponsored,
  };
}

/** Página de bloqueio/erro da Amazon (captcha, "Continuar comprando", "Algo deu errado") sem resultados. */
function isBlockedPage(html) {
  return /captcha|Digite os caracteres|api-services-support@amazon|Continuar comprando|Algo deu errado/i.test(html) &&
    !/s-search-result/.test(html);
}

async function search({ query, limit = 12 }) {
  await init();
  const page = await context.newPage();
  try {
    const res = await page.goto(`${BASE}/s?k=${encodeURIComponent(query)}`, {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
    });
    await page
      .waitForSelector('div[data-component-type="s-search-result"]', { timeout: 15000 })
      .catch(() => {});
    const html = await page.content();
    if (isBlockedPage(html)) throw new SourceError('BLOCKED', 'Amazon pediu verificação ou devolveu página de erro');
    if (res && res.status() >= 400) throw new SourceError('BLOCKED', `Amazon respondeu HTTP ${res.status()}`);
    const raw = await page.evaluate(extractInPage);
    if (!raw.length) throw new SourceError('PARSE', 'Nenhum resultado encontrado na página de busca');
    const items = raw.map(normalize).filter(Boolean).filter((p) => !p.sponsored);
    return items.slice(0, limit);
  } finally {
    await page.close();
    await sleep(1500 + Math.random() * 1500); // intervalo educado entre buscas (também após erro)
  }
}

module.exports = { id: 'amazon', label: 'Amazon', search, close, extractInPage, normalize, parseCount, isBlockedPage };
