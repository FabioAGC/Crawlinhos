/**
 * Magalu — não há API pública de catálogo para afiliados. Este adaptador lê o JSON
 * embutido (__NEXT_DATA__) da página de busca pública, com uma requisição comum e
 * identificada (sem disfarce de navegador). O site responde 403 (Akamai) a IPs de
 * datacenter; quando isso acontece a fonte é marcada BLOCKED e pulada — não há
 * tentativa de contornar o bloqueio.
 * Alternativa de produção: feed de produtos do Magalu via rede de afiliados
 * (Awin / Rakuten) ou a vitrine Parceiro Magalu (Magazine Você).
 *
 * ATENÇÃO: o parser foi escrito SEM acesso a uma página real (403 neste servidor).
 * Os nomes de campo são suposições; por isso ele aceita vários formatos.
 */
const { SourceError, http, parseBRL } = require('../util');

const BASE = 'https://www.magazineluiza.com.br';
const UA = 'RadarOfertas/0.1 (agregador de ofertas; Node.js fetch)';
const config = { base: BASE };

const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : null);
const first = (...vals) => {
  for (const v of vals) if (v != null && v !== '') return v;
  return null;
};

/** Preço em número: aceita 89.9, "89.90", "R$ 1.234,56" e objetos { value | amount }. */
function money(v) {
  if (isObj(v)) return money(first(v.value, v.amount, v.price));
  return parseBRL(v);
}

function title(p) {
  return str(first(p.title, p.name, p.productName, p.description));
}

/**
 * { price, listPrice } a partir dos vários formatos possíveis de preço.
 * Suposição (a confirmar com página real): em price = { bestPrice, fullPrice, price },
 * bestPrice é o preço à vista/Pix, fullPrice o preço a prazo e price o preço "de".
 * Só campos com nome de preço "de" viram listPrice, para não anunciar como desconto
 * a diferença entre Pix e cartão.
 */
function prices(p) {
  const pr = p.price;
  let current;
  let list;
  if (isObj(pr)) {
    current = [pr.bestPrice, pr.salePrice, pr.fullPrice, pr.value, pr.amount, pr.price];
    list = [pr.price, pr.listPrice, pr.originalPrice, pr.priceFrom, pr.oldPrice];
  } else {
    current = [p.bestPrice, p.salePrice, pr, p.fullPrice];
    list = [p.listPrice, p.originalPrice, p.priceFrom, p.oldPrice];
  }
  const cur = current.map(money).filter((n) => n != null);
  if (!cur.length) return null;
  const price = Math.min(...cur);
  const max = Math.max(0, ...list.map(money).filter((n) => n != null));
  return { price, listPrice: max > price ? max : null };
}

function productId(p) {
  return str(first(p.variationId, p.id, p.sku, p.productId, p.code));
}

function looksLikeProduct(x) {
  return isObj(x) && !!title(x) && !!productId(x) && !!prices(x);
}

/**
 * Percorre o JSON e devolve o MAIOR array cujos itens (maioria) têm cara de produto.
 * Maior, e não o primeiro: a página pode ter carrosséis de patrocinados antes da lista.
 */
function findProducts(root) {
  let best = null;
  const seen = new Set();
  const stack = [[root, 0]];
  let visited = 0;
  while (stack.length && visited < 200000) {
    const [node, depth] = stack.pop();
    if (!node || typeof node !== 'object' || depth > 25 || seen.has(node)) continue;
    seen.add(node);
    visited++;
    if (Array.isArray(node)) {
      const hits = node.filter(looksLikeProduct);
      if (hits.length && hits.length >= node.length / 2 && (!best || hits.length > best.length)) best = hits;
      for (const x of node) stack.push([x, depth + 1]);
    } else {
      for (const k of Object.keys(node)) stack.push([node[k], depth + 1]);
    }
  }
  return best;
}

/** Extrai o JSON de __NEXT_DATA__ (aceita atributos em qualquer ordem e aspas simples). */
function extractNextData(html) {
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    if (!/\bid\s*=\s*["']?__NEXT_DATA__["']?/i.test(m[1])) continue;
    try {
      return JSON.parse(m[2].trim());
    } catch {
      throw new SourceError('PARSE', '__NEXT_DATA__ do Magalu inválido');
    }
  }
  throw new SourceError('PARSE', 'Página do Magalu sem __NEXT_DATA__');
}

function parseHtml(html) {
  return findProducts(extractNextData(String(html || ''))) || [];
}

function imageUrl(p) {
  let img = first(p.image, p.imageUrl, p.thumbnail, Array.isArray(p.images) ? p.images[0] : null, Array.isArray(p.media) ? p.media[0] : null);
  if (isObj(img)) img = first(img.url, img.src, img.image);
  if (typeof img !== 'string' || !img) return null;
  img = img.replace(/\{w\}/g, '500').replace(/\{h\}/g, '500');
  if (img.startsWith('//')) img = `https:${img}`;
  return /^https?:\/\//i.test(img) ? img : null;
}

function normalize(p) {
  if (!isObj(p)) return null;
  const t = title(p);
  const pr = prices(p);
  const id = productId(p);
  if (!t || !pr || !id) return null;
  let raw = first(p.path, p.url, p.link, p.href, p.slug);
  raw = typeof raw === 'string' ? raw.trim() : '';
  if (!raw) return null; // sem link não há o que publicar
  let path;
  try {
    const u = new URL(raw, `${BASE}/`);
    if (!/(^|\.)magazineluiza\.com\.br$/i.test(u.hostname)) return null;
    path = u.pathname.replace(/^\/+/, '');
  } catch {
    return null;
  }
  if (!path) return null;
  const rating = isObj(p.rating) ? p.rating : {};
  const seller = isObj(p.seller) ? first(p.seller.description, p.seller.name, p.seller.id) : p.seller;
  return {
    source: 'magalu',
    sourceId: id,
    title: t,
    price: pr.price,
    listPrice: pr.listPrice,
    image: imageUrl(p),
    url: `${BASE}/${path}`,
    path,
    rating: parseBRL(first(rating.score, rating.average, p.ratingScore, typeof p.rating === 'number' ? p.rating : null)),
    reviews: parseInt(first(rating.count, rating.total, p.reviewCount, p.ratingCount), 10) || null,
    seller: str(seller),
  };
}

/** Página de bloqueio do Akamai às vezes chega com 200. */
const looksBlocked = (html) => /akamai-bot|N[ãa]o [ée] poss[íi]vel acessar a p[áa]gina|Access Denied/i.test(html.slice(0, 4000));

async function search({ query, limit = 12 }) {
  const n = Math.max(1, parseInt(limit, 10) || 12);
  const url = `${config.base}/busca/${encodeURIComponent(query).replace(/%20/g, '+')}/`;
  const res = await http(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR,pt;q=0.9', Accept: 'text/html' } });
  if (res.status === 403 || res.status === 429 || (res.status === 200 && looksBlocked(res.text)))
    throw new SourceError('BLOCKED', `Magalu recusou o acesso (HTTP ${res.status}) — comum em IP de datacenter`);
  if (res.status !== 200) throw new SourceError('HTTP', `Magalu HTTP ${res.status}`);
  const seen = new Set();
  return parseHtml(res.text).map(normalize).filter((p) => p && !seen.has(p.sourceId) && seen.add(p.sourceId)).slice(0, n);
}

module.exports = { id: 'magalu', label: 'Magalu', search, parseHtml, normalize, findProducts, extractNextData, _config: config };
