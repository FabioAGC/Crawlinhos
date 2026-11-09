/* Filtro por categoria/loja, busca e ordenação — sem framework, sobre o HTML já renderizado. */
(function () {
  var root = document.querySelector('.radar');
  if (!root) return;
  var grid = root.querySelector('[data-grid]');
  var cards = Array.prototype.slice.call(grid.children);
  var state = { cat: 'all', sort: root.getAttribute('data-default-sort') || 'destaque', q: '', store: '' };
  var num = function (el, k) { return parseFloat(el.getAttribute('data-' + k)) || 0; };
  var sorters = {
    destaque: function (a, b) { return num(b, 'score') - num(a, 'score'); },
    recentes: function (a, b) { return (b.getAttribute('data-first') || '').localeCompare(a.getAttribute('data-first') || '') || num(b, 'score') - num(a, 'score'); },
    menor_preco: function (a, b) { return num(a, 'price') - num(b, 'price'); },
    maior_preco: function (a, b) { return num(b, 'price') - num(a, 'price'); },
    desconto: function (a, b) { return num(b, 'disc') - num(a, 'disc'); },
    popularidade: function (a, b) { return num(b, 'pop') - num(a, 'pop'); }
  };
  var norm = function (s) { return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); };

  function apply() {
    var q = norm(state.q.trim()), shown = 0;
    cards.slice().sort(sorters[state.sort] || sorters.destaque).forEach(function (c) {
      var ok = (state.cat === 'all' || c.getAttribute('data-cat') === state.cat) &&
        (!state.store || c.getAttribute('data-store') === state.store) &&
        (!q || norm(c.getAttribute('data-title')).indexOf(q) > -1);
      c.hidden = !ok;
      if (ok) shown++;
      grid.appendChild(c);
    });
    root.querySelectorAll('[data-count]').forEach(function (e) { e.textContent = shown; });
    root.querySelectorAll('[data-cat-btn]').forEach(function (b) {
      b.classList.toggle('is-active', b.getAttribute('data-cat-btn') === state.cat);
    });
    root.querySelectorAll('[data-sort-btn]').forEach(function (b) {
      b.classList.toggle('is-active', b.getAttribute('data-sort-btn') === state.sort);
    });
    var lab = root.querySelector('[data-cat-label]');
    if (lab) {
      var act = root.querySelector('[data-cat-btn="' + state.cat + '"]');
      lab.textContent = (state.cat === 'all' ? 'Todas categorias' : act ? act.textContent.trim() : state.cat) + (state.store ? ' · ' + state.store : '');
    }
    var empty = root.querySelector('[data-empty]');
    if (empty) empty.hidden = shown > 0;
  }

  root.addEventListener('click', function (ev) {
    var t = ev.target.closest('[data-cat-btn],[data-sort-btn],[data-cat-link],[data-store]');
    if (!t || !root.contains(t)) return;
    if (t.hasAttribute('data-cat-btn')) { state.cat = t.getAttribute('data-cat-btn'); if (state.cat === 'all') state.store = ''; }
    else if (t.hasAttribute('data-sort-btn')) state.sort = t.getAttribute('data-sort-btn');
    else if (t.hasAttribute('data-cat-link')) state.cat = t.getAttribute('data-cat-link');
    else if (t.tagName === 'A' && t.hasAttribute('data-store')) {
      ev.preventDefault();
      state.store = t.getAttribute('data-store'); state.cat = 'all';
      var top = root.querySelector('#ofertas'); if (top) top.scrollIntoView({ behavior: 'smooth' });
    } else return;
    apply();
  });
  var search = root.querySelector('[data-search]');
  if (search) search.addEventListener('input', function () { state.q = search.value; apply(); });
  apply();
})();
