/* Tema BELEZA 02 — APOTHECARY (markup fiel ao layout original, agora com dados reais) */
const { esc, fmtBRL } = require('../util');

const leaf = (s) =>
  `<svg width="${s}" height="${s}" viewBox="0 0 14 14" fill="none"><path d="M2 12 C2 7, 5 3, 12 2 C11 9, 7 12, 2 12 Z" stroke="currentColor" stroke-width="0.9" fill="none"/><path d="M2 12 L11 3" stroke="currentColor" stroke-width="0.7"/></svg>`;
const svg = (inner) => `<svg width="13" height="13" viewBox="0 0 14 14" fill="none">${inner}</svg>`;
const GLYPHS = {
  all: svg('<circle cx="7" cy="7" r="5.5" stroke="currentColor" stroke-width="0.9"/><circle cx="7" cy="7" r="2" fill="currentColor"/>'),
  perfumes: svg('<rect x="4.5" y="6" width="5" height="6" rx="0.5" stroke="currentColor" stroke-width="0.9"/><rect x="5.5" y="4.5" width="3" height="1.5" stroke="currentColor" stroke-width="0.9"/><line x1="7" y1="2" x2="7" y2="4.5" stroke="currentColor" stroke-width="0.9"/>'),
  maquiagem: svg('<ellipse cx="7" cy="8" rx="3" ry="4" stroke="currentColor" stroke-width="0.9"/><line x1="7" y1="2.5" x2="7" y2="4" stroke="currentColor" stroke-width="0.9"/>'),
  skincare: leaf(13),
  cabelos: svg('<path d="M3 11 C3 6, 5 3, 7 3 C9 3, 11 6, 11 11" stroke="currentColor" stroke-width="0.9" fill="none"/><path d="M5 11 C5 8, 6 5, 7 5 C8 5, 9 8, 9 11" stroke="currentColor" stroke-width="0.7" fill="none"/>'),
  corpo: svg('<circle cx="7" cy="8" r="4" stroke="currentColor" stroke-width="0.9"/><path d="M7 4 Q5 7 7 8" stroke="currentColor" stroke-width="0.7"/>'),
  unhas: svg('<rect x="5" y="3" width="4" height="8" rx="2" stroke="currentColor" stroke-width="0.9"/>'),
  kits: svg('<rect x="2.5" y="5" width="9" height="7" stroke="currentColor" stroke-width="0.9"/><line x1="7" y1="5" x2="7" y2="12" stroke="currentColor" stroke-width="0.9"/><line x1="2.5" y1="8" x2="11.5" y2="8" stroke="currentColor" stroke-width="0.9"/>'),
};

function card(p, h, i) {
  return `<article class="card" ${h.dataAttrs(p)}>
  <a class="card-img-wrap" href="${esc(h.href(p))}" ${h.linkAttrs} tabindex="-1" aria-hidden="true">
    <div class="card-orn">${leaf(22)}</div>
    ${p.isNew ? '<span class="new">Novo</span>' : p.priceDropped ? '<span class="new">Baixou</span>' : ''}
    ${p.discount > 0 ? `<span class="disc">— <b>${p.discount}%</b></span>` : ''}
    ${p.image
      ? `<img class="card-img" src="${esc(p.image)}" alt="${esc(p.title)}" loading="lazy" decoding="async" referrerpolicy="no-referrer" ${h.imgFallback(p)}>`
      : `<div class="card-ph"><span>${esc(h.catLabel(p.cat))}</span></div>`}
  </a>
  <div class="card-body">
    <div class="card-tax"><span class="ix">№ ${String(i + 1).padStart(3, '0')}</span><span>${esc(h.catLabel(p.cat))} · ${esc(p.store)}</span></div>
    <h3 class="card-name"><a href="${esc(h.href(p))}" ${h.linkAttrs} title="${esc(p.title)}">${esc(p.title)}</a></h3>
    <div class="price-row">
      <span class="price-now">${fmtBRL(p.price)}</span>
      ${p.listPrice ? `<span class="price-orig">${fmtBRL(p.listPrice)}</span>` : ''}
    </div>
    <a class="card-cta" href="${esc(h.href(p))}" ${h.linkAttrs} aria-label="Ir para a loja: ${esc(p.title)}">Ir para a loja <span class="arr">→</span></a>
  </div>
</article>`;
}

function render({ products, cats, sorts, meta, h }) {
  const stores = meta.stores.map((s) => `<li><a href="#" data-store="${esc(s)}">${esc(s)}</a></li>`).join('');
  return `<div class="apot radar" data-default-sort="destaque">
  <div class="hdr">
    <div class="hdr-left">${leaf(16)}<span class="hdr-mark">Radar Beleza</span></div>
    <div class="hdr-right">
      <a href="#ofertas">Ofertas</a><a href="#lojas">Lojas</a><a href="#sobre">Sobre</a>
      <label class="hdr-search">⌕ <input type="search" data-search placeholder="Buscar" aria-label="Buscar produtos"></label>
      <a href="../bebe/">Radar Bebê →</a>
    </div>
  </div>
  <div class="brand">
    <div class="brand-eyebrow">Curadoria · Edição de ${esc(meta.edition)}</div>
    <h1 class="brand-title">A botica das <em>ofertas</em></h1>
    <p class="brand-sub">Selecionamos a cada manhã as melhores ofertas em perfumes, skincare e cosméticos das principais lojas do Brasil.</p>
    <div class="brand-orn"><span class="brand-orn-line"></span>${leaf(12)}<span class="brand-orn-mark">est. MMXXVI</span>${leaf(12)}<span class="brand-orn-line"></span></div>
  </div>
  <nav class="rail" id="ofertas" aria-label="Categorias"><div class="rail-inner">
    ${cats.map((c, i) => `<button type="button" data-cat-btn="${esc(c.id)}" class="cat ${i === 0 ? 'is-active' : ''}" aria-pressed="${i === 0}"><span class="cat-glyph">${GLYPHS[c.id] || GLYPHS.all}</span>${esc(c.label)}</button>`).join('')}
  </div></nav>
  <div class="ctrl">
    <div class="ctrl-l"><span class="num" data-count>${products.length}</span><span class="lbl">ofertas em curadoria<span data-cat-label-suffix></span> · atualizado ${esc(meta.updatedLabel)}</span></div>
    <div class="ctrl-r">
      ${sorts.map((s, i) => `<button type="button" data-sort-btn="${s.id}" class="sort-btn ${i === 0 ? 'is-active' : ''}" aria-pressed="${i === 0}">${esc(s.label)}</button>`).join('')}
    </div>
  </div>
  <main class="feed">
    <div class="grid" data-grid>${products.map((p, i) => card(p, h, i)).join('\n')}</div>
    <p class="empty" data-empty role="status" hidden>Nenhuma oferta encontrada com esse filtro.</p>
  </main>
  <footer class="foot">
    <div class="foot-inner">
      <div class="foot-brand" id="sobre">
        <h3>Radar Beleza</h3>
        <p>O jeito inteligente de encontrar os melhores preços em beleza, perfumes e cosméticos no Brasil.</p>
        <p class="disclosure">${esc(meta.disclosure)}</p>
      </div>
      <div class="foot-col"><h4>Categorias</h4><ul>
        ${cats.slice(1, 5).map((c) => `<li><a href="#ofertas" data-cat-link="${esc(c.id)}">${esc(c.label)}</a></li>`).join('')}
      </ul></div>
      <div class="foot-col" id="lojas"><h4>Lojas</h4><ul>${stores}</ul></div>
      <div class="foot-col"><h4>Radar</h4><ul>
        <li><a href="../bebe/">Radar Bebê</a></li><li><a href="../">Todos os radares</a></li>
      </ul></div>
    </div>
    <div class="foot-bottom">
      <span>© Radar Beleza · MMXXVI</span>
      <span>Os preços podem variar · verifique sempre na loja</span>
    </div>
  </footer>
</div>`;
}

const extraCss = `
html,body{margin:0;padding:0;background:#EDEAE0}
.apot{width:100%;min-height:100vh}
.apot .card[hidden]{display:none}
.apot .card-name a:hover{color:var(--sage)}
.apot .card-cta{text-decoration:none}
.apot .hdr-search{display:inline-flex;align-items:center;gap:6px}
.apot .hdr-search input{border:none;border-bottom:1px solid rgba(246,243,233,.4);background:none;font:inherit;color:var(--paper);width:110px;padding:3px 2px;outline:none}
.apot .hdr-search input::placeholder{color:rgba(246,243,233,.6)}
.apot .empty{text-align:center;color:var(--ink-3);padding:60px 0;font-size:14px}
.apot .disclosure{font-size:11.5px!important;color:var(--ink-3)!important;margin-top:12px}
.apot .ctrl-r{flex-wrap:wrap}
.apot .hdr-search input:focus-visible{outline:2px solid var(--paper);outline-offset:2px}
.apot a:focus-visible,.apot button:focus-visible{outline:2px solid var(--sage);outline-offset:3px}
.apot .hdr a:focus-visible{outline-color:var(--paper)}
.apot .rail-inner{padding:3px 0}
.apot .card-name a{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:5;overflow:hidden;overflow-wrap:anywhere}
.apot .card-tax{gap:10px}.apot .card-tax .ix{white-space:nowrap;flex-shrink:0}
.apot .card-tax span:last-child{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.apot .price-now,.apot .price-orig{white-space:nowrap}
.apot .card-ph span{text-align:center;padding:0 6px}
.apot .sort-btn{white-space:nowrap}
@media (prefers-reduced-motion:reduce){.apot .card,.apot .card-img{transition:none}}
@media (max-width:1100px){
  .apot .brand-title{font-size:60px}
  .apot .ctrl{flex-direction:column;align-items:flex-start;gap:14px}
  .apot .ctrl-r{border-radius:22px}
}
@media (max-width:900px){.apot .grid{grid-template-columns:repeat(2,1fr);gap:16px}}
@media (max-width:800px){
  .apot .hdr{padding:12px 16px;flex-direction:column;gap:10px}
  .apot .hdr-right{gap:14px;flex-wrap:wrap;justify-content:center}
  .apot .brand{padding:36px 16px 30px}.apot .brand-title{font-size:42px}
  .apot .rail{padding:14px 16px}.apot .rail-inner{justify-content:flex-start;flex-wrap:nowrap;overflow-x:auto}
  .apot .cat{flex-shrink:0;padding:8px 14px}
  .apot .ctrl{padding:22px 16px 14px;flex-direction:column;align-items:flex-start;gap:14px}
  .apot .ctrl-r{border-radius:14px}.apot .sort-btn{padding:7px 11px}
  .apot .feed{padding:8px 16px 44px}
  .apot .card-body{padding:14px 14px 16px}.apot .card-name{font-size:15.5px}
  .apot .card-tax{letter-spacing:.08em;font-size:9.5px;align-items:flex-start}
  .apot .card-tax span:last-child{white-space:normal;text-align:right}
  .apot .price-row{flex-wrap:wrap}.apot .price-now{font-size:20px}
  .apot .card-cta{padding:9px 14px}
  .apot .foot{padding:36px 16px 26px}.apot .foot-inner{grid-template-columns:1fr 1fr;gap:26px}
  .apot .foot-brand{grid-column:1/-1}.apot .foot-bottom{flex-direction:column;gap:8px}
}`;

module.exports = {
  id: 'apot',
  fonts: 'family=Fraunces:ital,opsz,wght,SOFT,WONK@0,9..144,300..500,0..100,0..1;1,9..144,300..500,0..100,0..1&family=Inter+Tight:wght@400;500&family=JetBrains+Mono:wght@400;500',
  description: 'As melhores ofertas do dia em perfumes, maquiagem, skincare e cabelos, comparadas nas principais lojas do Brasil.',
  render,
  extraCss,
};
