/**
 * Shopee — Affiliate Open API (GraphQL). É o caminho oficial: devolve produto,
 * comissão e o link de afiliado (offerLink) já pronto. O site público exige login
 * para busca, então não há modo "scraping".
 * Credenciais: affiliate.shopee.com.br > Open API (AppID + Secret).
 *
 * Assinatura (documentação da Open API):
 *   Authorization: SHA256 Credential={AppId}, Timestamp={ts}, Signature={sha256(AppId + ts + payload + Secret)}
 *   - ts em segundos; a API recusa timestamp muito defasado (relógio do servidor precisa estar certo)
 *   - payload = exatamente os bytes enviados no corpo do POST
 * Erros vêm com HTTP 200 e corpo { errors: [{ message, extensions: { code, message } }] }.
 */
const crypto = require('crypto');
const { SourceError, http } = require('../util');

const ENDPOINT = 'https://open-api.affiliate.shopee.com.br/graphql';
const MAX_LIMIT = 50;
const config = { endpoint: ENDPOINT };

// sortType: 1 relevância, 2 mais vendidos, 3 preço desc, 4 preço asc, 5 comissão desc
const SORT_SALES = 2;

// Campos de productOfferV2.nodes. `price` foi retirado de propósito: está marcado como
// obsoleto na documentação e um campo inexistente derruba a query inteira; priceMin basta.
const FIELDS = 'itemId shopId productName priceMin priceMax priceDiscountRate imageUrl productLink offerLink commissionRate sales ratingStar shopName';

function sign(appId, secret, payload, ts = Math.floor(Date.now() / 1000)) {
  const signature = crypto.createHash('sha256').update(`${appId}${ts}${payload}${secret}`, 'utf8').digest('hex');
  return { ts, signature, header: `SHA256 Credential=${appId}, Timestamp=${ts}, Signature=${signature}` };
}

const num = (v) => {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null;
};
const httpUrl = (u) => (typeof u === 'string' && /^https?:\/\//i.test(u) ? u : null);

function normalize(n) {
  if (!n || typeof n !== 'object') return null;
  const price = num(n.priceMin) ?? num(n.price);
  if (n.itemId == null || !n.productName || !price) return null;
  const itemId = String(n.itemId);
  const url = httpUrl(n.productLink) ||
    (n.shopId != null ? `https://shopee.com.br/product/${encodeURIComponent(n.shopId)}/${encodeURIComponent(itemId)}` : null);
  if (!url) return null;
  // priceDiscountRate: % de desconto como inteiro (10 = 10%). A confirmar com resposta real.
  const rate = num(n.priceDiscountRate) || 0;
  const listPrice = rate > 0 && rate < 95 ? Math.round((price / (1 - rate / 100)) * 100) / 100 : null;
  return {
    source: 'shopee',
    sourceId: itemId,
    title: String(n.productName),
    price,
    listPrice,
    image: httpUrl(n.imageUrl),
    url,
    affiliateUrl: httpUrl(n.offerLink), // já é o link de afiliado
    rating: num(n.ratingStar),
    reviews: null,
    sold: num(n.sales),
    commissionRate: num(n.commissionRate),
    seller: n.shopName || null,
  };
}

function buildPayload(query, limit, page = 1) {
  const gql = `{ productOfferV2(keyword: ${JSON.stringify(String(query))}, limit: ${limit}, page: ${page}, sortType: ${SORT_SALES}) { nodes { ${FIELDS} } pageInfo { page limit hasNextPage } } }`;
  return JSON.stringify({ query: gql });
}

/** Erro GraphQL (HTTP 200) -> SourceError. Códigos da documentação da Open API. */
function gqlError(e) {
  const ext = (e && e.extensions) || {};
  const code = Number(ext.code);
  const msg = [e && e.message, ext.message].filter(Boolean).join(' — ') || 'erro desconhecido';
  const text = `Shopee API${code ? ` [${code}]` : ''}: ${msg}`;
  if (code === 10020) return new SourceError('NO_CREDENTIALS', `${text} (confira SHOPEE_APP_ID/SHOPEE_SECRET e o relógio do servidor)`);
  if (code >= 10031 && code <= 10035) return new SourceError('BLOCKED', `${text} (conta de afiliado sem acesso à Open API)`);
  if (code === 10030) return new SourceError('HTTP', `${text} (limite de requisições)`);
  if (!code && /signature|credential|authenticat|timestamp|app ?id/i.test(msg)) return new SourceError('NO_CREDENTIALS', text);
  return new SourceError('HTTP', text);
}

async function search({ query, limit = 12 }) {
  const appId = (process.env.SHOPEE_APP_ID || '').trim();
  const secret = (process.env.SHOPEE_SECRET || '').trim();
  if (!appId || !secret) throw new SourceError('NO_CREDENTIALS', 'Defina SHOPEE_APP_ID e SHOPEE_SECRET (Affiliate Open API)');
  const n = Math.max(1, Math.min(parseInt(limit, 10) || 12, MAX_LIMIT));
  const payload = buildPayload(query, n);
  const { header } = sign(appId, secret, payload);
  const res = await http(config.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: header },
    body: payload, // os mesmos bytes que foram assinados
  });
  if (res.status === 401) throw new SourceError('NO_CREDENTIALS', 'Shopee HTTP 401: credenciais recusadas');
  if (res.status === 403) throw new SourceError('BLOCKED', 'Shopee HTTP 403: acesso recusado à Open API');
  if (res.status === 429) throw new SourceError('HTTP', 'Shopee HTTP 429: limite de requisições');
  if (res.status !== 200 || !res.json || typeof res.json !== 'object') throw new SourceError('HTTP', `Shopee HTTP ${res.status}`);
  if (Array.isArray(res.json.errors) && res.json.errors.length) throw gqlError(res.json.errors[0]);
  const nodes = res.json.data && res.json.data.productOfferV2 && res.json.data.productOfferV2.nodes;
  if (!Array.isArray(nodes)) {
    if (res.json.data && res.json.data.productOfferV2) return []; // busca sem resultado
    throw new SourceError('PARSE', 'Shopee: resposta sem data.productOfferV2');
  }
  return nodes.map(normalize).filter(Boolean).slice(0, n);
}

module.exports = { id: 'shopee', label: 'Shopee', search, normalize, sign, buildPayload, _config: config };
