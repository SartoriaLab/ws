// Macro-grupos do cardapio Wilson — agrupa abas EatFood em ~8 categorias visiveis.
// Carrega ANTES de scripts/main.js. Transforma window.menuData (preserva raw em window._menuDataRaw).
(function () {
  'use strict';

  var CONFIG = {
    // Abas EatFood escondidas no site (uso interno do tablet do cliente).
    hidden: [
      'abertura-de-comanda', 'amostradinho', 'copos', 'amendoim',
      'saladas', 'acompanhamentos',
      'batatas', 'lanches', 'porcoes', 'pizzas', 'file-pizza',
      'refrigerantes-e-sucos', 'file-pizza-c-acompanhamento',
      'rodizio-na-caixa', 'bebidas-e-doses'
    ],

    // Macro-grupos. Cada source vira sub-categoria dentro do grupo.
    // mergeMeias: { 'inteira-id': 'meia-id' } — funde itens da meia em precoMeia do item da inteira.
    groups: [
      { id: 'pizzas-salgadas', label: 'Pizzas', icon: '🍕',
        sources: ['pizza-grande', 'pizza-broto'] },
      { id: 'pizzas-doces', label: 'Pizzas Doces', icon: '🍰',
        sources: ['pizza-doce-individual', 'pizza-doce-broto'] },
      { id: 'lanches-grupo', label: 'Lanches', icon: '🥪',
        sources: ['lanche-de-hamburguer', 'lanche-de-frango', 'lanche-churrasco', 'laches-de-file-mignon', 'lanche-de-brocolis', 'hot-dog'] },
      { id: 'file-pizza-grupo', label: 'Filé Pizza', icon: '🍗',
        sources: [
          'file-pizza-frango-pequeno', 'file-pizza-frango-grande',
          'file-pizza-frango-completo-pequeno', 'file-pizza-frango-completo-grande',
          'file-pizza-carne-pequeno', 'file-pizza-carne-grande',
          'file-pizza-carne-completo-pequeno', 'file-pizza-carne-completo-grande'
        ] },
      { id: 'porcoes-grupo', label: 'Porções', icon: '🍟',
        sources: ['fritas-inteira', 'porcoes-quentes-inteira', 'porcoes-frias-inteira', 'arroz-de-forno'],
        mergeMeias: {
          'fritas-inteira': 'fritas-meia',
          'porcoes-quentes-inteira': 'porcoes-quentes-meia',
          'porcoes-frias-inteira': 'porcoes-frias-meia'
        } },
      { id: 'bebidas', label: 'Bebidas', icon: '🥤',
        sources: ['sucos-naturais-jarra', 'sucos', 'suco-natural-levar', 'refrigerantes', 'agua', 'energetico'] },
      { id: 'drinks-grupo', label: 'Drinks & Bar', icon: '🍹',
        sources: ['caipirinhas', 'drinks', 'doses', 'cervejas', 'vinhos'] },
      { id: 'sobremesas', label: 'Sobremesas', icon: '🍨',
        sources: ['doces', 'sorvetes-ice-by-nice', 'cookies', 'bolo-gelado-pedaco'] }
    ]
  };

  function findItensInTab(tab) {
    var out = [];
    (tab.categorias || []).forEach(function (cat) {
      if (cat.ativo === false) return;
      (cat.itens || []).forEach(function (it) {
        if (it.ativo !== false) out.push(it);
      });
    });
    return out;
  }

  function buildMacroMenu(rawData) {
    var byId = {};
    rawData.forEach(function (t) { byId[t.id] = t; });

    return CONFIG.groups.map(function (g) {
      var subSections = [];

      g.sources.forEach(function (srcId) {
        var src = byId[srcId];
        if (!src || src.ativo === false) return;

        var meiaId = g.mergeMeias && g.mergeMeias[srcId];
        var meiaItens = meiaId && byId[meiaId] ? findItensInTab(byId[meiaId]) : [];

        (src.categorias || []).forEach(function (cat) {
          if (cat.ativo === false) return;
          var itens = (cat.itens || []).filter(function (i) { return i.ativo !== false; });

          if (meiaItens.length) {
            var normalize = function (s) {
              return (s || '').toUpperCase()
                .replace(/\(\s*INTEIRA?\s*\)|\(\s*MEIA?\s*\)|\bINTEIRA\b|\bMEIA\b/g, '')
                .replace(/\s+/g, ' ')
                .trim();
            };
            itens = itens.map(function (it) {
              var key = normalize(it.nome);
              var match = meiaItens.find(function (m) { return normalize(m.nome) === key; });
              if (match && match.preco) {
                return Object.assign({}, it, {
                  nome: it.nome.replace(/\s*\(\s*INTEIRA?\s*\)\s*/i, '').replace(/\s*\bINTEIRA\b\s*/i, ' ').replace(/\s+/g, ' ').trim(),
                  precoMeia: match.preco
                });
              }
              return it;
            });
          }

          if (!itens.length) return;
          subSections.push({
            titulo: src.label,
            nota: cat.titulo && cat.titulo !== src.label ? cat.titulo : '',
            itens: itens,
            ativo: true,
            sourceTabId: srcId
          });
        });
      });

      return {
        id: g.id,
        label: (g.icon ? g.icon + ' ' : '') + g.label,
        ativo: subSections.length > 0,
        categorias: subSections
      };
    }).filter(function (g) { return g.ativo; });
  }

  function applyMacro() {
    if (!window.menuData) return;
    if (!window._menuDataRaw) window._menuDataRaw = window.menuData;
    var raw = window._menuDataRaw.filter(function (t) {
      return CONFIG.hidden.indexOf(t.id) === -1;
    });
    window.menuData = buildMacroMenu(raw);
  }

  window.menuGroupsConfig = CONFIG;
  window.applyMenuMacro = applyMacro;

  // Aplicar imediatamente sobre fallback estatico (data/menu.js).
  applyMacro();
})();
