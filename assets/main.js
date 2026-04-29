/**
 * Wilson's Pizzaria — UI principal
 * - Renderiza cardapio do Firestore (window.menuData populada por data/firestore.js)
 * - Tabs por macro-grupo, busca, mobile menu
 * - aplicarBusinessInfo(): hook chamado por firestore.js quando businessInfo chega
 */
(function () {
  'use strict';

  // === Mobile nav ===
  var burger = document.querySelector('.mobile-toggle');
  var nav = document.getElementById('nav');
  if (burger && nav) {
    burger.addEventListener('click', function () {
      var open = nav.classList.toggle('is-open');
      burger.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    nav.addEventListener('click', function (e) {
      if (e.target.tagName === 'A') {
        nav.classList.remove('is-open');
        burger.setAttribute('aria-expanded', 'false');
      }
    });
  }

  // === Mapeamento EatFood -> macro-grupos ===
  // chave = id slug da aba EatFood; valor = macro-grupo
  var GRUPO_MAP = {
    'pizza-grande': 'Pizzas Salgadas',
    'pizza-broto': 'Pizzas Salgadas',
    'file-pizza-frango-completo-pequeno': 'Pizzas Salgadas',
    'file-pizza-frango-completo-grande': 'Pizzas Salgadas',
    'file-pizza-carne-completo-pequeno': 'Pizzas Salgadas',
    'file-pizza-carne-completo-grande': 'Pizzas Salgadas',
    'file-pizza-frango-pequeno': 'Pizzas Salgadas',
    'file-pizza-frango-grande': 'Pizzas Salgadas',
    'file-pizza-carne-pequeno': 'Pizzas Salgadas',
    'file-pizza-carne-grande': 'Pizzas Salgadas',

    'pizza-doce-individual': 'Pizzas Doces',
    'pizza-doce-broto': 'Pizzas Doces',

    'lanche-de-brocolis': 'Lanches',
    'lanche-churrasco': 'Lanches',
    'laches-de-file-mignon': 'Lanches',
    'hot-dog': 'Lanches',
    'lanche-de-frango': 'Lanches',
    'lanche-de-hamburguer': 'Lanches',

    'fritas-inteira': 'Porções',
    'fritas-meia': 'Porções',
    'amostradinho': 'Porções',
    'arroz-de-forno': 'Porções',
    'saladas': 'Porções',
    'porcoes-quentes-meia': 'Porções',
    'porcoes-quentes-inteira': 'Porções',
    'porcoes-frias-inteira': 'Porções',
    'porcoes-frias-meia': 'Porções',
    'acompanhamentos': 'Porções',

    'copos': 'Bebidas',
    'agua': 'Bebidas',
    'sucos-naturais-jarra': 'Bebidas',
    'sucos': 'Bebidas',
    'refrigerantes': 'Bebidas',
    'energetico': 'Bebidas',
    'suco-natural-levar': 'Bebidas',

    'vinhos': 'Drinks',
    'caipirinhas': 'Drinks',
    'cervejas': 'Drinks',
    'doses': 'Drinks',
    'drinks': 'Drinks',
    'bebidas-e-doses': 'Drinks',

    'bolo-gelado-pedaco': 'Sobremesas',
    'doces': 'Sobremesas',
    'sorvetes-ice-by-nice': 'Sobremesas',
    'cookies': 'Sobremesas',
    'amendoim': 'Sobremesas',

    'abertura-de-comanda': null  // ocultar
  };

  var GRUPOS_ORDEM = [
    'Pizzas Salgadas',
    'Pizzas Doces',
    'Lanches',
    'Porções',
    'Drinks',
    'Bebidas',
    'Sobremesas'
  ];

  function classificarAbas(menuData) {
    var grupos = {};
    GRUPOS_ORDEM.forEach(function (g) { grupos[g] = []; });

    (menuData || []).forEach(function (aba) {
      if (!aba || aba.ativo === false) return;
      var grupo = GRUPO_MAP.hasOwnProperty(aba.id) ? GRUPO_MAP[aba.id] : 'Outros';
      if (grupo === null) return;
      if (!grupos[grupo]) grupos[grupo] = [];

      var itensAtivos = [];
      (aba.categorias || []).forEach(function (cat) {
        if (cat.ativo === false) return;
        (cat.itens || []).forEach(function (item) {
          if (item.ativo !== false) itensAtivos.push(item);
        });
      });

      if (itensAtivos.length === 0) return;

      grupos[grupo].push({
        label: aba.label,
        itens: itensAtivos
      });
    });

    // remove grupos vazios
    var resultado = [];
    GRUPOS_ORDEM.concat(['Outros']).forEach(function (g) {
      if (grupos[g] && grupos[g].length > 0) {
        resultado.push({ nome: g, abas: grupos[g] });
      }
    });
    return resultado;
  }

  // === Render ===
  var grupoAtual = null;
  var pendingTab = null;
  var termoBusca = '';

  function fmtPreco(v) {
    var n = Number(v) || 0;
    return 'R$ ' + n.toFixed(2).replace('.', ',');
  }
  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function tituloItem(s) {
    return String(s || '').toLowerCase().replace(/(^|\s)\S/g, function (c) { return c.toUpperCase(); });
  }
  function limparDesc(s) {
    return String(s || '').replace(/^Ingredientes:\s*/i, '').trim();
  }

  function renderTabs(grupos) {
    var tabs = document.getElementById('menu-tabs');
    if (!tabs) return;
    tabs.innerHTML = '';
    grupos.forEach(function (g) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'menu-tab' + (g.nome === grupoAtual ? ' is-active' : '');
      btn.textContent = g.nome;
      btn.addEventListener('click', function () {
        grupoAtual = g.nome;
        renderAll();
      });
      tabs.appendChild(btn);
    });
  }

  function renderGrid(grupos) {
    var grid = document.getElementById('menu-grid');
    var empty = document.getElementById('menu-empty');
    var loading = document.getElementById('menu-loading');
    if (!grid) return;
    if (loading) loading.hidden = true;

    var grupo = grupos.find(function (g) { return g.nome === grupoAtual; }) || grupos[0];
    if (!grupo) {
      grid.innerHTML = '';
      if (empty) empty.hidden = false;
      return;
    }

    var html = '';
    var encontrouAlgo = false;

    grupo.abas.forEach(function (aba) {
      var itensFiltrados = aba.itens.filter(function (it) {
        if (!termoBusca) return true;
        var alvo = (it.nome + ' ' + (it.desc || '')).toLowerCase();
        return alvo.indexOf(termoBusca) !== -1;
      });
      if (itensFiltrados.length === 0) return;
      encontrouAlgo = true;
      html += '<div class="menu-cat"><h3>' + escapeHtml(aba.label) + '</h3></div>';
      itensFiltrados.forEach(function (it) {
        html += '<article class="menu-item">';
        html +=   '<div class="menu-item-head">';
        html +=     '<span class="menu-item-name">' + escapeHtml(tituloItem(it.nome)) + '</span>';
        if (it.preco) html += '<span class="menu-item-price">' + fmtPreco(it.preco) + '</span>';
        html +=   '</div>';
        var d = limparDesc(it.desc);
        if (d) html += '<p class="menu-item-desc">' + escapeHtml(d) + '</p>';
        html += '</article>';
      });
    });

    grid.innerHTML = html;
    if (empty) empty.hidden = encontrouAlgo;
  }

  var gruposCache = [];
  function renderAll() {
    if (!gruposCache.length) return;
    if (pendingTab) { grupoAtual = pendingTab; pendingTab = null; }
    if (!grupoAtual && gruposCache[0]) grupoAtual = gruposCache[0].nome;
    renderTabs(gruposCache);
    renderGrid(gruposCache);
  }

  // === Hook chamado por firestore.js quando cardapio chega ===
  window.createMenu = function () {
    gruposCache = classificarAbas(window.menuData || []);
    if (!pendingTab) grupoAtual = null;
    renderAll();
  };

  // === Navegação direta para aba do cardápio ===
  window.goToTab = function (tabName) {
    pendingTab = tabName;
    grupoAtual = tabName;
    if (gruposCache.length) renderAll();
  };

  // === Hook businessInfo (placeholder — site ja tem dados hardcoded; pode ser usado pra override) ===
  window.aplicarBusinessInfo = function (info) {
    if (!info) return;
    // placeholder: tudo ja vem hardcoded no HTML; futuro override aqui se precisar
  };

  // === Busca ===
  var inputBusca = document.getElementById('menu-search');
  if (inputBusca) {
    var debounce;
    inputBusca.addEventListener('input', function (e) {
      clearTimeout(debounce);
      debounce = setTimeout(function () {
        termoBusca = e.target.value.trim().toLowerCase();
        renderGrid(gruposCache);
      }, 150);
    });
  }

  // Render inicial se menuData ja tiver carregado (file://) ou fallback
  if (window.menuData && window.menuData.length > 0) {
    window.createMenu();
  }
})();
