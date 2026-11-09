/* Tema BEBÊ 03 — ACONCHEGO (markup fiel ao layout original, agora com dados reais) */
const { esc, fmtBRL } = require('../util');

const HEART =
  '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 12s-5-3.2-5-6.4A2.7 2.7 0 017 3.4 2.7 2.7 0 0112 5.6C12 8.8 7 12 7 12z" stroke="currentColor" stroke-width="1.1"/></svg>';

function card(p, h) {
  return `<article class="card" ${h.dataAttrs(p)}>
  <a class="card-img-wrap" href="${esc(h.href(p))}" ${h.linkAttrs} aria-label="${esc(p.title)}">
    ${p.age ? `<span class="age">${esc(p.age)}</span>` : ''}
    ${p.discount > 0 ? `<span class="disc">- <b>${p.discount}%</b></span>` : ''}
    ${p.isNew ? '<span class="new">Novo</span>' : p.priceDropped ? '<span class="new">Baixou</span>' : ''}
    ${p.image
      ? `<img class="card-img" src="${esc(p.image)}" alt="${esc(p.title)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.outerHTML='<div class=&quot;card-ph&quot;><span>${esc(h.catLabel(p.cat))}</span></div>'">`
      : `<div class="card-ph"><span>${esc(h.catLabel(p.cat))}</span></div>`}
    <span class="wish" aria-hidden="true">${HEART}</span>
  </a>
  <div class="card-meta"><span class="cat-pill">${esc(h.catLabel(p.cat))}</span><span>${esc(p.store)}</span></div>
  <h3 class="card-name"><a href="${esc(h.href(p))}" ${h.linkAttrs}>${esc(p.title)}</a></h3>
  <div class="price-row">
    <div class="price-l">
      <span class="price-now">${fmtBRL(p.price)}</span>
      ${p.listPrice ? `<span class="price-orig">${fmtBRL(p.listPrice)}</span>` : ''}
    </div>
    <a class="price-r" href="${esc(h.href(p))}" ${h.linkAttrs}>Ver <span class="arr">→</span></a>
  </div>
</article>`;
}

function render({ products, cats, sorts, meta, h }) {
  const tick = [`${meta.storeCount} ${meta.storeCount === 1 ? 'loja monitorada' : 'lojas monitoradas'}`, 'Atualizado todos os dias', `${products.length} ofertas ativas`, 'Preços conferidos na loja', 'Links de afiliado · sem custo para você'];
  const tickHtml = [...tick, ...tick, ...tick].map((t) => `<span>${esc(t)}</span><span class="dot">◆</span>`).join('');
  const stores = meta.stores.map((s) => `<li><a href="#" data-store="${esc(s)}">${esc(s)}</a></li>`).join('');
  return `<div class="acon radar" data-default-sort="destaque">
  <div class="tick"><div class="tick-track">${tickHtml}</div></div>
  <header class="hdr">
    <div class="hdr-l"><a href="#ofertas">Ofertas</a><a href="#lojas">Lojas</a><a href="#sobre">Sobre</a></div>
    <h1 class="wordmark">RADAR <span class="dot">·</span> BEBÊ</h1>
    <div class="hdr-r">
      <label class="hdr-search">⌕ <input type="search" data-search placeholder="Buscar" aria-label="Buscar produtos"></label>
      <a href="../beleza/" class="hdr-cta">Radar Beleza →</a>
    </div>
  </header>
  <nav class="cats"><div class="cats-inner">
    ${cats.map((c, i) => `<button data-cat-btn="${c.id}" class="cat ${i === 0 ? 'is-active' : ''}">${esc(c.label)}</button>`).join('')}
  </div></nav>
  <section class="title" id="ofertas">
    <h2 class="title-h">Pequenas <em>preciosidades</em>,<br>todos os dias.</h2>
    <div class="title-meta">
      <span><b data-count>${products.length}</b> ofertas ativas</span>
      <span>Edição · ${esc(meta.edition)}</span>
      <span>Atualizado <b>${esc(meta.updatedLabel)}</b></span>
    </div>
  </section>
  <div class="sort">
    <div class="sort-l"><b data-cat-label>Todas categorias</b> · <span data-count>${products.length}</span> produtos</div>
    <div class="sort-r">
      <span class="sort-lab">Ordenar por</span>
      ${sorts.map((s, i) => `<button data-sort-btn="${s.id}" class="sort-btn ${i === 0 ? 'is-active' : ''}">${esc(s.label)}</button>`).join('')}
    </div>
  </div>
  <main class="feed">
    <div class="grid" data-grid>${products.map((p) => card(p, h)).join('\n')}</div>
    <p class="empty" data-empty hidden>Nenhuma oferta encontrada com esse filtro.</p>
  </main>
  <footer class="foot">
    <div class="foot-inner">
      <div class="foot-brand" id="sobre">
        <div class="mk">RADAR <span class="dot">·</span> BEBÊ</div>
        <p>O jeito carinhoso e inteligente de encontrar os melhores preços em produtos para bebê no Brasil.</p>
        <p class="disclosure">${esc(meta.disclosure)}</p>
      </div>
      <div class="foot-col"><h4>Categorias</h4><ul>
        ${cats.slice(1, 5).map((c) => `<li><a href="#ofertas" data-cat-link="${c.id}">${esc(c.label)}</a></li>`).join('')}
      </ul></div>
      <div class="foot-col" id="lojas"><h4>Lojas</h4><ul>${stores}</ul></div>
      <div class="foot-col"><h4>Radar</h4><ul>
        <li><a href="../beleza/">Radar Beleza</a></li><li><a href="../">Todos os radares</a></li>
      </ul></div>
    </div>
    <div class="foot-bottom">
      <span>© ${meta.year} Radar Bebê · Todos os direitos reservados</span>
      <span>Os preços podem variar · verifique sempre na loja</span>
    </div>
  </footer>
</div>`;
}

const extraCss = `
html,body{margin:0;padding:0;background:#FAF7F4}
.acon{width:100%;min-height:100vh}
.acon .card-img-wrap{cursor:pointer}
.acon .card-name a:hover{color:var(--lilac-dk)}
.acon .card[hidden]{display:none}
.acon .hdr-search{display:inline-flex;align-items:center;gap:6px}
.acon .hdr-search input{border:none;border-bottom:1px solid var(--rule);background:none;font:inherit;color:var(--ink);width:120px;padding:4px 2px;outline:none}
.acon .hdr-search input:focus{border-color:var(--ink)}
.acon .hdr-r{align-items:center}
.acon .empty{text-align:center;color:var(--ink-3);padding:60px 0;font-size:14px}
.acon .disclosure{font-size:11.5px!important;color:var(--ink-3)!important;margin-top:14px}
.acon .foot-inner{grid-template-columns:2fr 1fr 1fr 1fr}
.acon .price-now{white-space:nowrap}
@media (max-width:1100px){.acon .grid{grid-template-columns:repeat(3,1fr)}.acon .title-h{font-size:64px}}
@media (max-width:800px){
  .acon .hdr{grid-template-columns:1fr;padding:18px 16px;gap:12px;text-align:center}
  .acon .hdr-l,.acon .hdr-r{justify-content:center}
  .acon .cats{padding:0 4px}.acon .cat{padding:14px 14px}
  .acon .title{grid-template-columns:1fr;padding:32px 16px 20px;gap:18px}
  .acon .title-h{font-size:44px}.acon .title-meta{align-items:flex-start}
  .acon .sort{padding:0 16px 14px;flex-direction:column;align-items:flex-start;gap:10px}
  .acon .sort-r{flex-wrap:wrap}.acon .sort-lab{display:none}.acon .sort-btn{padding:6px 10px 6px 0;border:none}
  .acon .feed{padding:24px 16px 56px}
  .acon .grid{grid-template-columns:repeat(2,1fr);gap:24px 14px}
  .acon .price-now{font-size:22px}.acon .price-row{flex-wrap:wrap}
  .acon .foot{padding:48px 16px 28px}.acon .foot-inner{grid-template-columns:1fr 1fr;gap:28px}
  .acon .foot-brand{grid-column:1/-1}.acon .foot-bottom{flex-direction:column;gap:8px}
}`;

module.exports = {
  id: 'acon',
  fonts: 'family=Italiana&family=Cormorant+Garamond:ital,wght@1,400;1,500&family=Manrope:wght@400;500;600&family=JetBrains+Mono:wght@400;500',
  description: 'As melhores ofertas do dia em fraldas, higiene, alimentação e passeio para bebês, comparadas nas principais lojas do Brasil.',
  render,
  extraCss,
};
