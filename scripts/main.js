(function () {
  var sections = document.querySelectorAll("section[id]");
  var navLinks = document.querySelectorAll(".nav a[data-section]");
  var header = document.getElementById("header");
  var nav = document.getElementById("nav");
  var mobileToggle = document.getElementById("mobileToggle");
  var floatWpp = document.getElementById("floatWpp");

  // ── localStorage helpers ──
  var STORAGE_KEYS = {
    CART: 'wp_cart_v1',
    CUSTOMER: 'wp_customer_v1'
  };
  function storageGet(key) {
    try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : null; }
    catch(e) { return null; }
  }
  function storageSet(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch(e) {}
  }
  function storageRemove(key) {
    try { localStorage.removeItem(key); } catch(e) {}
  }

  // Carrega o carrinho do localStorage e normaliza items legados (sem quantity)
  var cart = (storageGet(STORAGE_KEYS.CART) || []).map(function(it) {
    if (!it) return null;
    if (typeof it.quantity !== 'number' || it.quantity < 1) it.quantity = 1;
    return it;
  }).filter(Boolean);

  function saveCart() { storageSet(STORAGE_KEYS.CART, cart); }
  function clearCart() { cart = []; saveCart(); }

  var currentItem = null;
  var currentTabId = null;
  var allPizzas = [];
  var panelsListenerAttached = false;
  var DELIVERY_FEE = 7.00;
  var currentCartStep = 1;
  var CART_STEP_TITLES = { 1: 'Seu Pedido', 2: 'Entrega', 3: 'Pagamento' };

  function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function brl(value) {
    if (typeof value !== "number") return "";
    return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  // ── Parser de horário de funcionamento ──
  // getDay(): 0=Dom, 1=Seg, 2=Ter, 3=Qua, 4=Qui, 5=Sex, 6=Sab
  var DAY_KEYS = ['Dom','Seg','Ter','Qua','Qui','Sex','Sab'];
  var DAY_LABELS_FULL = ['domingo','segunda','terça','quarta','quinta','sexta','sábado'];

  function parseHourStr(s) {
    var m = s.match(/(\d{1,2})h(\d{2})?/);
    if (!m) return null;
    return parseInt(m[1], 10) * 60 + (m[2] ? parseInt(m[2], 10) : 0);
  }
  function formatMin(min) {
    var h = Math.floor(min / 60), m = min % 60;
    return h + 'h' + (m > 0 ? (m < 10 ? '0'+m : m) : '');
  }
  function parseBusinessHours(str) {
    var out = {};
    DAY_KEYS.forEach(function(d) { out[d] = null; });
    if (!str) return out;
    str.split('|').forEach(function(part) {
      part = part.trim();
      var m = part.match(/^(\w{3})\s+(.+)$/);
      if (!m) return;
      var day = m[1], range = m[2].trim();
      // Normaliza acento
      day = day.charAt(0).toUpperCase() + day.slice(1).toLowerCase();
      if (/fechad/i.test(range)) { out[day] = null; return; }
      var rm = range.match(/(\d{1,2}h(?:\d{2})?)\s*[-–]\s*(\d{1,2}h(?:\d{2})?)/);
      if (rm) {
        var openMin = parseHourStr(rm[1]);
        var closeMin = parseHourStr(rm[2]);
        if (openMin != null && closeMin != null) out[day] = [openMin, closeMin];
      }
    });
    return out;
  }
  function isOpenNow(hours) {
    var now = new Date();
    var dayKey = DAY_KEYS[now.getDay()];
    var range = hours[dayKey];
    var minutes = now.getHours() * 60 + now.getMinutes();
    if (range) {
      var openMin = range[0], closeMin = range[1];
      // Se fechar passa da meia-noite
      if (closeMin <= openMin) closeMin += 24 * 60;
      var checkMin = minutes;
      if (minutes < openMin && minutes < (closeMin - 24*60)) checkMin = minutes + 24*60;
      if (minutes >= openMin && minutes < closeMin) {
        return { open: true, closesAt: closeMin };
      }
    }
    return { open: false, nextOpen: findNextOpen(hours, now) };
  }
  function findNextOpen(hours, from) {
    for (var i = 0; i < 7; i++) {
      var d = new Date(from);
      d.setDate(from.getDate() + i);
      var key = DAY_KEYS[d.getDay()];
      var r = hours[key];
      if (!r) continue;
      if (i === 0) {
        var nowMin = from.getHours() * 60 + from.getMinutes();
        if (nowMin >= r[0]) continue;
      }
      var label = i === 0 ? 'hoje' : (i === 1 ? 'amanhã' : DAY_LABELS_FULL[d.getDay()]);
      return { day: label, openMin: r[0] };
    }
    return null;
  }
  function refreshOpenStatus() {
    var hoursStr = (window._businessInfo && window._businessInfo.hours && window._businessInfo.hours.completo) || '';
    if (!hoursStr) return;
    var hours = parseBusinessHours(hoursStr);
    var status = isOpenNow(hours);
    window._isClosed = !status.open;
    var el = document.getElementById('openStatus');
    if (!el) return;
    el.hidden = false;
    el.classList.toggle('is-open', status.open);
    el.classList.toggle('is-closed', !status.open);
    var txtEl = el.querySelector('.open-status-text');
    if (!txtEl) return;
    if (status.open) {
      txtEl.innerText = 'Aberto agora';
      el.title = 'Fecha às ' + formatMin(status.closesAt > 24*60 ? status.closesAt - 24*60 : status.closesAt);
    } else if (status.nextOpen) {
      txtEl.innerText = 'Fechado · abre ' + status.nextOpen.day + ' às ' + formatMin(status.nextOpen.openMin);
    } else {
      txtEl.innerText = 'Fechado';
    }
  }

  // --- Helpers cardapio-admin ---

  function isDestaque(item) {
    return item.destaque === true ||
      (Array.isArray(item.tags) && item.tags.indexOf('destaque') !== -1);
  }

  function isPizzaTab(tabId) {
    return tabId && tabId.indexOf('pizza') !== -1;
  }

  // --- MENU ---

  function findTabById(tabId) {
    if (!window.menuData) return null;
    var src = window._menuDataRaw || window.menuData;
    for (var i = 0; i < src.length; i++) {
      if (src[i].id === tabId) return src[i];
    }
    return null;
  }

  function getPizzasForTab(tabId) {
    var tab = findTabById(tabId);
    if (!tab) return [];
    var pizzas = [];
    (tab.categorias || []).forEach(function(cat) {
      if (cat.ativo === false) return;
      (cat.itens || []).forEach(function(item) {
        if (item.ativo !== false) pizzas.push(item);
      });
    });
    return pizzas;
  }

  function extractAllPizzas() {
    allPizzas = [];
    var src = window._menuDataRaw || window.menuData;
    if (!src) return;
    src.forEach(function(section) {
      if (section.ativo === false) return;
      if (!isPizzaTab(section.id)) return;
      (section.categorias || []).forEach(function(cat) {
        if (cat.ativo === false) return;
        (cat.itens || []).forEach(function(item) {
          if (item.ativo === false) return;
          allPizzas.push(item);
        });
      });
    });
  }

  function buildFlavorPartRow(index, tabId, fixedNome, fixedPreco) {
    var html = '<div class="flavor-part-row" data-index="' + index + '">';
    html += '<span class="part-label">Parte ' + (index + 1) + '</span>';
    if (fixedNome !== undefined) {
      html += '<span class="part-name-fixed" data-price="' + (fixedPreco || 0) + '">' + escapeHtml(fixedNome) + '</span>';
    } else {
      var pizzas = getPizzasForTab(tabId);
      html += '<div class="select-wrapper">';
      html += '<select class="flavor-part-select">';
      html += '<option value="" data-price="0">Selecione o sabor...</option>';
      pizzas.forEach(function(p) {
        html += '<option value="' + escapeHtml(p.nome || '') + '" data-price="' + (p.preco || 0) + '">' + escapeHtml(p.nome) + '</option>';
      });
      html += '</select></div>';
      html += '<button type="button" class="btn-remove-part" aria-label="Remover parte">✕</button>';
    }
    html += '</div>';
    return html;
  }

  function createMenu() {
    var tabs = document.getElementById("menuTabs");
    var panels = document.getElementById("menuPanels");
    if (!tabs || !panels || !window.menuData) return;

    // Filtrar abas ativas e ordenar: "promocao-do-dia" primeiro, depois demais promos, depois o resto
    var activeTabs = menuData.filter(function(tab) { return tab.ativo !== false; });
    function promoWeight(tab) {
      if (tab.id === 'promocao-do-dia') return 2;
      if (tab.id && tab.id.indexOf('promocao') !== -1) return 1;
      return 0;
    }
    activeTabs.sort(function(a, b) { return promoWeight(b) - promoWeight(a); });

    extractAllPizzas();

    // Tab ativa: primeira aba que tenha pelo menos um item ativo
    function tabTemItens(tab) {
      return (tab.categorias || []).some(function(cat) {
        return cat.ativo !== false && (cat.itens || []).some(function(item) { return item.ativo !== false; });
      });
    }
    var primeiraComItens = activeTabs.filter(tabTemItens)[0];
    var activeTabId = primeiraComItens ? primeiraComItens.id : (activeTabs.length > 0 ? activeTabs[0].id : null);

    tabs.innerHTML = activeTabs.map(function (section) {
      var isPromo = section.id && section.id.indexOf('promocao') !== -1;
      return '<button class="menu-tab' + (section.id === activeTabId ? ' active' : '') + (isPromo ? ' menu-tab-promo' : '') + '" data-tab="' + escapeHtml(section.id) + '">' +
        (isPromo ? '🏷️ ' : '') + escapeHtml(section.label) + '</button>';
    }).join("");

    panels.innerHTML = activeTabs.map(function (section) {
      var categoriasAtivas = (section.categorias || []).filter(function(cat) { return cat.ativo !== false; });
      var hasMultipleSubs = categoriasAtivas.length > 1;

      var subTabsHtml = hasMultipleSubs
        ? '<div class="menu-subtabs" data-subtabs-for="' + escapeHtml(section.id) + '">' +
            categoriasAtivas.map(function (cat, idx) {
              var subId = (cat.sourceTabId || section.id + '-sub-' + idx);
              return '<button type="button" class="menu-subtab' + (idx === 0 ? ' active' : '') + '" data-subtab="' + escapeHtml(subId) + '">' + escapeHtml(cat.titulo) + '</button>';
            }).join('') +
          '</div>'
        : '';

      return (
        '<div class="menu-panel' + (section.id === activeTabId ? ' active' : '') + '" data-panel="' + section.id + '">' +
          subTabsHtml +
          categoriasAtivas.map(function (cat, idx) {
            var itens = (cat.itens || []).filter(function(item) { return item.ativo !== false; });
            itens.sort(function(a, b) { return (isDestaque(b) ? 1 : 0) - (isDestaque(a) ? 1 : 0); });
            var subId = (cat.sourceTabId || section.id + '-sub-' + idx);
            var subActive = !hasMultipleSubs || idx === 0;

            return (
              '<div class="menu-section' + (subActive ? ' active' : '') + '" data-sub="' + escapeHtml(subId) + '">' +
                (!hasMultipleSubs ? '<h3 class="menu-section-title">' + escapeHtml(cat.titulo) + '</h3>' : '') +
                (cat.nota ? '<p class="menu-section-note">' + escapeHtml(cat.nota) + '</p>' : '') +
                '<div class="menu-grid">' +
                  itens.map(function (item) {
                    var dataTabId = cat.sourceTabId || section.id;
                    var precoBlock = '';
                    if (item.preco && item.precoMeia) {
                      precoBlock = '<span class="menu-price menu-price-dual">' + brl(item.preco) + ' <small>· meia ' + brl(item.precoMeia) + '</small></span>';
                    } else if (item.preco) {
                      precoBlock = '<span class="menu-price">' + brl(item.preco) + '</span>';
                    }
                    var promoBadge = item.emPromocao ? '<span class="menu-item-promo-badge">PROMO</span>' : '';
                    return (
                      '<article class="menu-item reveal' + (item.emPromocao ? ' is-promo' : '') + '" data-tab-id="' + escapeHtml(dataTabId) + '" data-nome="' + escapeHtml(item.nome || '') + '">' +
                        promoBadge +
                        '<div class="menu-item-top">' +
                          '<h4>' + escapeHtml(item.nome || '') + '</h4>' +
                          precoBlock +
                        '</div>' +
                        (item.desc ? '<p>' + escapeHtml(item.desc) + '</p>' : '') +
                        (item.tags && item.tags.length > 0 ? '<div class="menu-item-tags">' + renderTags(item.tags) + '</div>' : '') +
                      '</article>'
                    );
                  }).join("") +
                '</div>' +
              '</div>'
            );
          }).join("") +
        '</div>'
      );
    }).join("");

    // Sub-tabs click handlers (delegation no panels)
    panels.querySelectorAll('.menu-subtabs').forEach(function (group) {
      group.addEventListener('click', function (e) {
        var btn = e.target.closest('.menu-subtab');
        if (!btn) return;
        var subId = btn.dataset.subtab;
        var panel = btn.closest('.menu-panel');
        if (!panel) return;
        group.querySelectorAll('.menu-subtab').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        panel.querySelectorAll('.menu-section').forEach(function (s) {
          s.classList.toggle('active', s.dataset.sub === subId);
        });
        if (typeof initReveal === 'function') setTimeout(initReveal, 10);
      });
    });

    // Tab click handlers
    tabs.querySelectorAll(".menu-tab").forEach(function (button) {
      button.addEventListener("click", function () {
        tabs.querySelectorAll(".menu-tab").forEach(function (tab) { tab.classList.remove("active"); });
        panels.querySelectorAll(".menu-panel").forEach(function (panel) { panel.classList.remove("active"); });
        button.classList.add("active");
        var target = panels.querySelector('[data-panel="' + button.dataset.tab + '"]');
        if (target) target.classList.add("active");
        setTimeout(initReveal, 10);
      });
    });

    // Item click -> modal (delegation, registrar apenas uma vez)
    if (!panelsListenerAttached) { panelsListenerAttached = true;
    panels.addEventListener("click", function (event) {
      var itemNode = event.target.closest(".menu-item");
      if (!itemNode) return;

      var tabId = itemNode.dataset.tabId;
      var nome = itemNode.dataset.nome;

      // Buscar item nos dados
      var itemData = findItemByNome(tabId, nome);
      if (itemData) {
        openItemModal(itemData, tabId);
      }
    });
    } // fim panelsListenerAttached

    // Promo buttons
    document.querySelectorAll('.btn-promo').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var pName = this.dataset.name;
        var pPrice = parseFloat(this.dataset.price);
        var pPizza = this.dataset.ispizza === "true";
        var itemData = {
          nome: pName,
          preco: pPrice,
          desc: "Promocao Especial.",
          isPromo: true
        };
        openItemModal(itemData, pPizza ? "pizzas" : "promo");
      });
    });

    renderPromocoes();

    // Re-observar os .reveal recém-criados. Sem isso, quando o Firestore
    // chega depois do render inicial e createMenu() roda de novo, os novos
    // itens ficam com opacity:0 até o usuário clicar numa aba.
    if (typeof initReveal === 'function') {
      setTimeout(initReveal, 10);
    }
  }

  function coletarPromocoes() {
    var src = window._menuDataRaw || window.menuData || [];
    var promos = [];
    src.forEach(function (tab) {
      if (tab.ativo === false) return;
      (tab.categorias || []).forEach(function (cat) {
        if (cat.ativo === false) return;
        (cat.itens || []).forEach(function (item) {
          if (item.ativo !== false && item.emPromocao && item.precoOriginal && item.preco < item.precoOriginal) {
            promos.push({ item: item, tabId: tab.id });
          }
        });
      });
    });
    return promos;
  }

  function renderPromocoes() {
    var grid = document.getElementById('promoGrid');
    var section = document.getElementById('promocoes');
    var navLink = document.getElementById('navPromocoes');
    if (!grid || !section) return;

    var promos = coletarPromocoes();
    if (!promos.length) {
      section.hidden = true;
      if (navLink) navLink.hidden = true;
      grid.innerHTML = '';
      return;
    }
    section.hidden = false;
    if (navLink) navLink.hidden = false;

    grid.innerHTML = promos.map(function (p) {
      var it = p.item;
      return (
        '<article class="promo-card-product reveal" data-tab-id="' + escapeHtml(p.tabId) + '" data-nome="' + escapeHtml(it.nome) + '">' +
          '<div class="promo-card-body">' +
            '<h4>' + escapeHtml(it.nome) + '</h4>' +
            (it.desc ? '<p>' + escapeHtml(it.desc) + '</p>' : '') +
            '<div class="promo-card-prices">' +
              '<span class="promo-price-old">' + brl(it.precoOriginal) + '</span>' +
              '<span class="promo-price-new">' + brl(it.preco) + '</span>' +
            '</div>' +
            '<button type="button" class="btn btn-primary promo-card-btn">Pedir agora</button>' +
          '</div>' +
        '</article>'
      );
    }).join('');

    grid.querySelectorAll('.promo-card-product').forEach(function (card) {
      card.addEventListener('click', function () {
        var tabId = card.dataset.tabId;
        var nome = card.dataset.nome;
        var itemData = findItemByNome(tabId, nome);
        if (itemData) openItemModal(itemData, tabId);
      });
    });
  }

  window.renderPromocoes = renderPromocoes;

  function findItemByNome(tabId, nome) {
    var src = window._menuDataRaw || window.menuData;
    if (!src) return null;
    for (var t = 0; t < src.length; t++) {
      if (src[t].id !== tabId) continue;
      var cats = src[t].categorias || [];
      for (var c = 0; c < cats.length; c++) {
        var itens = cats[c].itens || [];
        for (var i = 0; i < itens.length; i++) {
          if (itens[i].nome === nome) return itens[i];
        }
      }
    }
    return null;
  }

  function renderTags(tags) {
    var tagMap = {
      destaque: '⭐',
      promocao: '🏷️',
      vegetariano: '🌿',
      vegano: '🌱',
      'sem-gluten': '🌾',
      picante: '🌶️',
      novo: '✨',
      'favorito-chef': '👨‍🍳'
    };
    return tags.map(function(tag) {
      return '<span class="tag tag-' + escapeHtml(tag) + '" title="' + escapeHtml(tag) + '">' + (tagMap[tag] || escapeHtml(tag)) + '</span>';
    }).join('');
  }

  // Expor createMenu para chamada pelo firestore.js
  window.createMenu = createMenu;

  // --- MODAL DE PRODUTO ---
  function openItemModal(itemData, sectionId) {
    currentItem = itemData;
    currentTabId = sectionId;
    var tab = findTabById(sectionId);
    var divisao = (tab && tab.divisao) || 0;
    var isPizza = isPizzaTab(sectionId);

    document.getElementById('modalPizzaName').innerText = itemData.nome || '';
    document.getElementById('modalPizzaDesc').innerText = itemData.desc || 'Preparado com ingredientes selecionados.';

    // Wilson: tamanho ja vem da aba (pizza-grande / pizza-broto). Esconde selector.
    document.getElementById('pizzaSizeWrapper').style.display = 'none';

    var splitWrapper = document.getElementById('flavorSplitWrapper');
    var addBtn = document.getElementById('addFlavorPart');
    var partsList = document.getElementById('flavorPartsList');

    if (isPizza && divisao > 1) {
      var labelEl = document.getElementById('flavorSplitLabel');
      if (labelEl) labelEl.textContent = 'Dividir em até ' + divisao + ' sabores';
      partsList.innerHTML = buildFlavorPartRow(0, sectionId, itemData.nome, itemData.preco);
      if (addBtn) addBtn.style.display = 'block';
      splitWrapper.style.display = 'block';
    } else {
      splitWrapper.style.display = 'none';
      if (partsList) partsList.innerHTML = '';
    }

    document.getElementById('pizzaNotes').value = '';
    updateModalPrice();
    document.getElementById('pizzaModal').classList.add('active');
    document.body.style.overflow = "hidden";
  }

  function updateModalPrice() {
    var price = currentItem ? (currentItem.preco || 0) : 0;
    var splitWrapper = document.getElementById('flavorSplitWrapper');
    if (splitWrapper && splitWrapper.style.display !== 'none') {
      var fixedPart = document.querySelector('.part-name-fixed');
      if (fixedPart) price = parseFloat(fixedPart.getAttribute('data-price')) || price;
      document.querySelectorAll('.flavor-part-select').forEach(function(sel) {
        var opt = sel.options[sel.selectedIndex];
        if (opt && opt.value) {
          var p = parseFloat(opt.getAttribute('data-price')) || 0;
          if (p > price) price = p;
        }
      });
    }
    document.getElementById('modalPrice').innerText = brl(price);
    return price;
  }

  // Event delegation para flavor parts (mudanca de select e remocao)
  var flavorPartsList = document.getElementById('flavorPartsList');
  if (flavorPartsList) {
    flavorPartsList.addEventListener('change', function(e) {
      if (e.target.classList.contains('flavor-part-select')) updateModalPrice();
    });
    flavorPartsList.addEventListener('click', function(e) {
      if (!e.target.classList.contains('btn-remove-part')) return;
      var row = e.target.closest('.flavor-part-row');
      if (!row) return;
      row.parentNode.removeChild(row);
      // Re-numerar partes
      flavorPartsList.querySelectorAll('.flavor-part-row').forEach(function(r, i) {
        r.dataset.index = i;
        var lbl = r.querySelector('.part-label');
        if (lbl) lbl.textContent = 'Parte ' + (i + 1);
      });
      updateModalPrice();
      var tab = findTabById(currentTabId);
      var divisao = (tab && tab.divisao) || 2;
      var addBtn = document.getElementById('addFlavorPart');
      if (addBtn) addBtn.style.display = flavorPartsList.querySelectorAll('.flavor-part-row').length < divisao ? 'block' : 'none';
    });
  }

  var addFlavorPartBtn = document.getElementById('addFlavorPart');
  if (addFlavorPartBtn) {
    addFlavorPartBtn.addEventListener('click', function() {
      var tab = findTabById(currentTabId);
      var divisao = (tab && tab.divisao) || 2;
      var rows = flavorPartsList.querySelectorAll('.flavor-part-row');
      if (rows.length >= divisao) return;
      var newIndex = rows.length;
      flavorPartsList.insertAdjacentHTML('beforeend', buildFlavorPartRow(newIndex, currentTabId));
      if (flavorPartsList.querySelectorAll('.flavor-part-row').length >= divisao) {
        this.style.display = 'none';
      }
    });
  }

  var addToCartBtn = document.getElementById('addToCartBtn');
  if(addToCartBtn) {
    addToCartBtn.addEventListener('click', function() {
      var finalPrice = updateModalPrice();
      var notes = document.getElementById('pizzaNotes').value;
      var isPizza = document.getElementById('pizzaSizeWrapper').style.display !== 'none';
      var finalName = currentItem.nome || '';

      if (isPizza) {
        var size = document.getElementById('pizzaSize').value;
        var splitWrapper = document.getElementById('flavorSplitWrapper');
        if (splitWrapper && splitWrapper.style.display !== 'none') {
          var parts = [currentItem.nome];
          document.querySelectorAll('.flavor-part-select').forEach(function(sel) {
            if (sel.value) parts.push(sel.value);
          });
          if (parts.length > 1) finalName = parts.join(' / ');
        }
        finalName += ' (Tam: ' + size + ')';
      }

      // Dedup: se já existe item idêntico, incrementa quantidade
      var existing = cart.find(function(it) {
        return it.name === finalName && (it.notes || '') === (notes || '');
      });
      if (existing) {
        existing.quantity += 1;
      } else {
        cart.push({ name: finalName, price: finalPrice, notes: notes, quantity: 1 });
      }
      saveCart();
      closeModal('pizzaModal');
      updateCartUI();
      showAddedToast(finalName);
    });
  }

  // ── Toast pós-adição ao carrinho ──
  var _toastTimer = null;
  function showAddedToast(itemName) {
    var existing = document.getElementById('cartAddedToast');
    if (existing) existing.remove();
    if (_toastTimer) clearTimeout(_toastTimer);

    var toast = document.createElement('div');
    toast.id = 'cartAddedToast';
    toast.className = 'cart-added-toast';
    toast.innerHTML =
      '<div class="cart-toast-info">' +
        '<span class="cart-toast-icon">🍕</span>' +
        '<div>' +
          '<strong>' + escapeHtml(itemName) + '</strong>' +
          '<span>adicionado ao carrinho</span>' +
        '</div>' +
      '</div>' +
      '<div class="cart-toast-actions">' +
        '<button class="cart-toast-btn cart-toast-more" id="toastKeepBtn">+ Mais itens</button>' +
        '<button class="cart-toast-btn cart-toast-checkout" id="toastCheckoutBtn">Finalizar</button>' +
      '</div>';
    document.body.appendChild(toast);

    // Animar entrada
    requestAnimationFrame(function() { toast.classList.add('cart-toast-visible'); });

    function dismissToast() {
      toast.classList.remove('cart-toast-visible');
      _toastTimer = setTimeout(function() { if (toast.parentNode) toast.remove(); }, 350);
    }

    document.getElementById('toastKeepBtn').addEventListener('click', dismissToast);

    document.getElementById('toastCheckoutBtn').addEventListener('click', function() {
      dismissToast();
      // Pequeno delay pra toast sair antes do modal abrir
      setTimeout(function() {
        if (cart.length === 0) return;
        currentCartStep = 0;
        renderCartModal();
        document.querySelectorAll('#cartModal .error').forEach(function(el) { el.classList.remove('error'); });
        document.querySelectorAll('#cartModal .error-msg').forEach(function(el) { el.hidden = true; });
        var confirmOverlay = document.getElementById('cartConfirmOverlay');
        if (confirmOverlay) confirmOverlay.hidden = true;
        var firstDeliveryRadio = document.querySelector('input[name="deliveryOption"][value="delivery"]');
        if (firstDeliveryRadio) firstDeliveryRadio.checked = true;
        var deliveryFields = document.getElementById('deliveryFields');
        if (deliveryFields) deliveryFields.style.display = 'block';
        var firstPaymentRadio = document.querySelector('input[name="paymentMethod"][value="PIX"]');
        if (firstPaymentRadio) firstPaymentRadio.checked = true;
        document.getElementById('changeWrapper').style.display = 'none';
        goToCartStep(1);
        document.getElementById('cartModal').classList.add('active');
        document.body.style.overflow = 'hidden';
      }, 300);
    });

    // Auto-dismiss após 5s
    _toastTimer = setTimeout(dismissToast, 5000);
  }

  function updateCartUI() {
    var floatingCart = document.getElementById('floatingCart');
    if (cart.length > 0) {
      floatingCart.style.display = 'flex';
      var totalItems = cart.reduce(function(a, i) { return a + (i.quantity || 1); }, 0);
      document.getElementById('cartCount').innerText = totalItems;
      var total = cart.reduce(function(acc, item) { return acc + (item.price * (item.quantity || 1)); }, 0);
      document.getElementById('cartTotalDisplay').innerText = brl(total);
      if(floatWpp) floatWpp.classList.add('lifted');
    } else {
      floatingCart.style.display = 'none';
      if(floatWpp) floatWpp.classList.remove('lifted');
    }
  }

  // --- MODAL DO CARRINHO (WIZARD) ---

  // ── Helpers de validação inline ──
  function showFieldError(inputId, msg) {
    var input = document.getElementById(inputId);
    if (!input) return;
    input.classList.add('error');
    var errEl = document.getElementById(inputId + 'Error') || input.parentNode.querySelector('.error-msg');
    if (errEl) { errEl.innerText = msg; errEl.hidden = false; }
  }
  function clearFieldError(inputId) {
    var input = document.getElementById(inputId);
    if (!input) return;
    input.classList.remove('error');
    var errEl = document.getElementById(inputId + 'Error') || input.parentNode.querySelector('.error-msg');
    if (errEl) { errEl.hidden = true; }
  }
  function focusFirstError() {
    // Foca e rola até o primeiro campo com erro no modal ativo
    var firstError = document.querySelector('#cartModal .error, #cartModal input.error, #cartModal textarea.error');
    if (firstError) {
      firstError.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(function() { firstError.focus({ preventScroll: true }); }, 200);
    }
  }

  function validateStep(n) {
    if (n === 1) return cart.length > 0;
    if (n === 2) {
      var ok = true;
      var name = (document.getElementById('customerName').value || '').trim();
      if (!name) { showFieldError('customerName', 'Informe seu nome'); ok = false; }
      var radioDelivery = document.querySelector('input[name="deliveryOption"]:checked');
      var isDelivery = radioDelivery && radioDelivery.value === 'delivery';
      if (isDelivery) {
        var addr = (document.getElementById('customerAddress').value || '').trim();
        if (!addr) { showFieldError('customerAddress', 'Informe o endereço'); ok = false; }
      }
      if (!ok) focusFirstError();
      return ok;
    }
    return true;
  }

  // ── ViaCEP ──
  function lookupCep(cep) {
    cep = cep.replace(/\D/g, '');
    if (cep.length !== 8) return;
    var loadingEl = document.getElementById('customerCepLoading');
    clearFieldError('customerCep');
    if (loadingEl) loadingEl.hidden = false;
    fetch('https://viacep.com.br/ws/' + cep + '/json/')
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (loadingEl) loadingEl.hidden = true;
        if (data.erro) { showFieldError('customerCep', 'CEP não encontrado'); return; }
        document.getElementById('customerAddress').value = data.logradouro || '';
        document.getElementById('customerNeighborhood').value = data.bairro || '';
        clearFieldError('customerAddress');
        document.getElementById('customerAddress').focus();
      })
      .catch(function() {
        if (loadingEl) loadingEl.hidden = true;
        showFieldError('customerCep', 'Erro ao buscar CEP. Preencha manualmente.');
      });
  }

  // ── Atualiza totais (step 3) ──
  function updateCartTotals(subtotal) {
    var radioDelivery = document.querySelector('input[name="deliveryOption"]:checked');
    var isDelivery = radioDelivery && radioDelivery.value === 'delivery';
    var fee = isDelivery ? DELIVERY_FEE : 0.00;
    var finalTotal = subtotal + fee;
    var subEl = document.getElementById('cartSubtotalValue');
    var feeEl = document.getElementById('cartFeeValue');
    var totalEl = document.getElementById('cartFinalTotal');
    if (subEl) subEl.innerText = brl(subtotal);
    if (feeEl) feeEl.innerText = brl(fee);
    if (totalEl) totalEl.innerText = brl(finalTotal);
  }

  // ── Renderizar lista de itens ──
  function renderCartModal() {
    var list = document.getElementById('cartItemsList');
    list.innerHTML = '';
    var subtotal = 0;
    cart.forEach(function(item, index) {
      var qty = item.quantity || 1;
      var lineTotal = item.price * qty;
      subtotal += lineTotal;
      list.innerHTML +=
        '<div class="cart-item-row">' +
          '<div class="cart-item-info">' +
            '<strong>' + escapeHtml(item.name) + '</strong>' +
            (item.notes ? '<span class="cart-item-notes">Obs: ' + escapeHtml(item.notes) + '</span>' : '') +
            '<div class="cart-qty-control">' +
              '<button type="button" class="cart-qty-btn" data-qty-action="dec" data-index="' + index + '" aria-label="Diminuir quantidade">−</button>' +
              '<span class="cart-qty-value">' + qty + '</span>' +
              '<button type="button" class="cart-qty-btn" data-qty-action="inc" data-index="' + index + '" aria-label="Aumentar quantidade">+</button>' +
              '<button type="button" class="cart-qty-remove" data-qty-action="remove" data-index="' + index + '" aria-label="Remover item">🗑</button>' +
            '</div>' +
          '</div>' +
          '<div class="cart-item-price">' + brl(lineTotal) + '</div>' +
        '</div>';
    });
    var step1Subtotal = document.getElementById('step1Subtotal');
    if (step1Subtotal) step1Subtotal.innerText = brl(subtotal);
    updateCartTotals(subtotal);
  }

  // ── Event delegation: +/- e remover ──
  var cartItemsList = document.getElementById('cartItemsList');
  if (cartItemsList) {
    cartItemsList.addEventListener('click', function(e) {
      var btn = e.target.closest('[data-qty-action]');
      if (!btn) return;
      var idx = parseInt(btn.dataset.index, 10);
      if (isNaN(idx) || !cart[idx]) return;
      var action = btn.dataset.qtyAction;
      if (action === 'inc') {
        cart[idx].quantity = (cart[idx].quantity || 1) + 1;
      } else if (action === 'dec') {
        cart[idx].quantity = (cart[idx].quantity || 1) - 1;
        if (cart[idx].quantity <= 0) cart.splice(idx, 1);
      } else if (action === 'remove') {
        cart.splice(idx, 1);
      }
      saveCart();
      if (cart.length === 0) { closeModal('cartModal'); }
      else { renderCartModal(); }
      updateCartUI();
    });
  }

  // ── Navegação do wizard ──
  function goToCartStep(n) {
    // Validar step atual se estiver avançando
    if (n > currentCartStep && !validateStep(currentCartStep)) return;

    // Esconder todos panels, mostrar o target
    document.querySelectorAll('.cart-step-panel').forEach(function(p) { p.hidden = true; });
    var target = document.querySelector('.cart-step-panel[data-panel="' + n + '"]');
    if (target) target.hidden = false;

    // Resetar scroll pro topo
    var scrollEl = document.querySelector('#cartModal .modal-content-scroll');
    if (scrollEl) scrollEl.scrollTop = 0;

    // Atualizar stepper visual
    document.querySelectorAll('.cart-step').forEach(function(s) {
      var sNum = parseInt(s.dataset.step, 10);
      s.classList.remove('active', 'completed');
      s.removeAttribute('aria-current');
      if (sNum === n) { s.classList.add('active'); s.setAttribute('aria-current', 'step'); }
      else if (sNum < n) s.classList.add('completed');
    });

    // Título
    var titleEl = document.getElementById('cartModalTitle');
    if (titleEl) titleEl.innerText = CART_STEP_TITLES[n] || '';

    // Botões
    var backBtn = document.getElementById('cartBackBtn');
    var nextBtn = document.getElementById('cartNextBtn');
    if (backBtn) backBtn.hidden = (n === 1);
    if (nextBtn) {
      nextBtn.innerText = (n === 3) ? 'Revisar pedido →' : 'Continuar →';
    }

    // Visibilidade dos campos de entrega no step 2
    if (n === 2) {
      var radioDelivery = document.querySelector('input[name="deliveryOption"]:checked');
      var isDelivery = !radioDelivery || radioDelivery.value === 'delivery';
      var deliveryFields = document.getElementById('deliveryFields');
      if (deliveryFields) deliveryFields.style.display = isDelivery ? 'block' : 'none';
    }

    // Atualizar totais no step 3
    if (n === 3) {
      var subtotal = cart.reduce(function(a, i) { return a + (i.price * (i.quantity || 1)); }, 0);
      updateCartTotals(subtotal);
    }

    // Foco no primeiro input do step
    if (target) {
      var firstInput = target.querySelector('input:not([type="radio"]), select, textarea');
      if (firstInput) setTimeout(function() { firstInput.focus({ preventScroll: true }); }, 50);
    }

    currentCartStep = n;
  }

  // ── Abrir confirmação ──
  function openConfirmStep() {
    var radioDelivery = document.querySelector('input[name="deliveryOption"]:checked');
    var isDelivery = radioDelivery && radioDelivery.value === 'delivery';
    var cName = (document.getElementById('customerName').value || '').trim();
    var cCep = (document.getElementById('customerCep').value || '').trim();
    var cAddress = (document.getElementById('customerAddress').value || '').trim();
    var cNeighborhood = (document.getElementById('customerNeighborhood').value || '').trim();
    var cComplement = (document.getElementById('customerComplement').value || '').trim();
    var paymentRadio = document.querySelector('input[name="paymentMethod"]:checked');
    var cPayment = paymentRadio ? paymentRadio.value : 'PIX';
    var cChange = (document.getElementById('cashChange').value || '').trim();

    var subtotal = cart.reduce(function(a, i) { return a + (i.price * (i.quantity || 1)); }, 0);
    var fee = isDelivery ? DELIVERY_FEE : 0;
    var total = subtotal + fee;

    var rows = '';
    rows += '<div class="confirm-summary-row"><span>👤 Nome</span><strong>' + escapeHtml(cName) + '</strong></div>';
    if (isDelivery) {
      rows += '<div class="confirm-summary-row"><span>🛵 Tipo</span><strong>Entrega</strong></div>';
      var enderecoCompleto = escapeHtml(cAddress);
      if (cNeighborhood) enderecoCompleto += ', ' + escapeHtml(cNeighborhood);
      if (cCep) enderecoCompleto += ' — CEP ' + escapeHtml(cCep);
      if (cComplement) enderecoCompleto += '<br><small>' + escapeHtml(cComplement) + '</small>';
      rows += '<div class="confirm-summary-row"><span>📍 Endereço</span><strong>' + enderecoCompleto + '</strong></div>';
    } else {
      rows += '<div class="confirm-summary-row"><span>🏪 Tipo</span><strong>Retirar no Balcão</strong></div>';
    }
    rows += '<div class="confirm-summary-row"><span>💳 Pagamento</span><strong>' + escapeHtml(cPayment) + '</strong></div>';
    if (cPayment === 'Dinheiro' && cChange) {
      rows += '<div class="confirm-summary-row"><span>💵 Troco para</span><strong>R$ ' + escapeHtml(cChange) + '</strong></div>';
    }
    rows += '<div class="confirm-summary-row confirm-summary-total"><span>💰 Total</span><strong>' + brl(total) + '</strong></div>';

    var summaryEl = document.getElementById('confirmSummary');
    if (summaryEl) summaryEl.innerHTML = rows;

    var overlay = document.getElementById('cartConfirmOverlay');
    if (overlay) overlay.hidden = false;
  }

  // ── Enviar pedido no WhatsApp ──
  function sendWhatsAppOrder() {
    var radioDelivery = document.querySelector('input[name="deliveryOption"]:checked');
    var isDelivery = radioDelivery && radioDelivery.value === 'delivery';
    var cName = (document.getElementById('customerName').value || '').trim();
    var cCep = (document.getElementById('customerCep').value || '').trim();
    var cAddress = (document.getElementById('customerAddress').value || '').trim();
    var cNeighborhood = (document.getElementById('customerNeighborhood').value || '').trim();
    var cComplement = (document.getElementById('customerComplement').value || '').trim();
    var paymentRadio = document.querySelector('input[name="paymentMethod"]:checked');
    var cPayment = paymentRadio ? paymentRadio.value : 'PIX';
    var cChange = (document.getElementById('cashChange').value || '').trim();

    var fee = isDelivery ? DELIVERY_FEE : 0.00;
    var subtotal = cart.reduce(function(acc, item) { return acc + (item.price * (item.quantity || 1)); }, 0);
    var total = subtotal + fee;
    var waNumber = (window._businessInfo && window._businessInfo.whatsappNumber) || '5516997384914';

    var message = "🍕 *NOVO PEDIDO - WILSON'S PIZZARIA* 🍕\n\n";
    message += "👤 *Nome:* " + cName + "\n";
    if (isDelivery) {
      message += "🛵 *Tipo:* Entrega\n";
      if (cCep) message += "📮 *CEP:* " + cCep + "\n";
      message += "📍 *Rua/Nº:* " + cAddress + "\n";
      if (cNeighborhood) message += "🏘️ *Bairro:* " + cNeighborhood + "\n";
      if (cComplement) message += "📌 *Complemento:* " + cComplement + "\n";
    } else {
      message += "🏪 *Tipo:* Retirar no Balcão\n";
    }
    message += "💳 *Pagamento:* " + cPayment + "\n";
    if (cPayment === 'Dinheiro' && cChange) {
      message += "💵 *Troco para:* R$ " + cChange + "\n";
    }
    // Aviso fora do horário
    if (window._isClosed) {
      message += "⏰ *Atenção:* Pedido feito fora do horário de funcionamento. Confirmaremos quando reabrir.\n";
    }

    message += "\n📋 *ITENS DO PEDIDO:*\n";
    cart.forEach(function(item, index) {
      var qty = (item.quantity || 1);
      var qtyPrefix = qty > 1 ? qty + 'x ' : '';
      message += "*" + (index + 1) + ". " + qtyPrefix + item.name + "* - " + brl(item.price * qty) + "\n";
      if (item.notes) message += "   _Obs: " + item.notes + "_\n";
    });
    message += "\n➖➖➖➖➖➖➖➖\n";
    message += "Subtotal: " + brl(subtotal) + "\n";
    if (isDelivery) message += "Taxa de Entrega: " + brl(fee) + "\n";
    message += "💰 *TOTAL A PAGAR: " + brl(total) + "*\n";
    message += "➖➖➖➖➖➖➖➖\n";

    // Persiste dados do cliente pra próxima visita
    storageSet(STORAGE_KEYS.CUSTOMER, {
      name: cName, cep: cCep, address: cAddress,
      neighborhood: cNeighborhood, complement: cComplement
    });

    var whatsappUrl = "https://wa.me/" + waNumber + "?text=" + encodeURIComponent(message);
    window.open(whatsappUrl, "_blank");

    // Limpar carrinho e fechar modal após enviar
    clearCart();
    closeModal('cartModal');
    var confirmOverlay = document.getElementById('cartConfirmOverlay');
    if (confirmOverlay) confirmOverlay.hidden = true;
    updateCartUI();
  }

  // ── Listeners do wizard ──
  var openCartBtn = document.getElementById('openCartBtn');
  if (openCartBtn) {
    openCartBtn.addEventListener('click', function() {
      if (cart.length === 0) return;
      // Reset do wizard
      currentCartStep = 0; // força re-render
      renderCartModal();
      // Limpar erros antigos
      document.querySelectorAll('#cartModal .error').forEach(function(el) { el.classList.remove('error'); });
      document.querySelectorAll('#cartModal .error-msg').forEach(function(el) { el.hidden = true; });
      // Esconder overlay de confirmação
      var confirmOverlay = document.getElementById('cartConfirmOverlay');
      if (confirmOverlay) confirmOverlay.hidden = true;
      // Resetar para o delivery option padrão
      var firstDeliveryRadio = document.querySelector('input[name="deliveryOption"][value="delivery"]');
      if (firstDeliveryRadio) firstDeliveryRadio.checked = true;
      // Resetar para o pagamento padrão
      var firstPaymentRadio = document.querySelector('input[name="paymentMethod"][value="PIX"]');
      if (firstPaymentRadio) firstPaymentRadio.checked = true;
      document.getElementById('changeWrapper').style.display = 'none';
      var changeResult = document.getElementById('changeResult');
      if (changeResult) changeResult.hidden = true;
      // Pré-preencher dados salvos do cliente
      var savedCustomer = storageGet(STORAGE_KEYS.CUSTOMER);
      if (savedCustomer) {
        var setVal = function(id, v) { var el = document.getElementById(id); if (el) el.value = v || ''; };
        setVal('customerName', savedCustomer.name);
        setVal('customerCep', savedCustomer.cep);
        setVal('customerAddress', savedCustomer.address);
        setVal('customerNeighborhood', savedCustomer.neighborhood);
        setVal('customerComplement', savedCustomer.complement);
      }
      // Aviso de fechado (Batch 2 set window._isClosed)
      var closedWarning = document.getElementById('cartClosedWarning');
      if (closedWarning) closedWarning.hidden = !window._isClosed;
      // Ir para step 1
      goToCartStep(1);
      document.getElementById('cartModal').classList.add('active');
      document.body.style.overflow = 'hidden';
    });
  }

  var cartBackBtn = document.getElementById('cartBackBtn');
  if (cartBackBtn) {
    cartBackBtn.addEventListener('click', function() {
      goToCartStep(currentCartStep - 1);
    });
  }

  var cartNextBtn = document.getElementById('cartNextBtn');
  if (cartNextBtn) {
    cartNextBtn.addEventListener('click', function() {
      if (currentCartStep < 3) {
        goToCartStep(currentCartStep + 1);
      } else {
        openConfirmStep();
      }
    });
  }

  var confirmBackBtn = document.getElementById('confirmBackBtn');
  if (confirmBackBtn) {
    confirmBackBtn.addEventListener('click', function() {
      var overlay = document.getElementById('cartConfirmOverlay');
      if (overlay) overlay.hidden = true;
    });
  }

  var confirmSendBtn = document.getElementById('confirmSendBtn');
  if (confirmSendBtn) {
    confirmSendBtn.addEventListener('click', function() {
      sendWhatsAppOrder();
    });
  }

  // ── Listener: opções de entrega (step 2) ──
  document.querySelectorAll('input[name="deliveryOption"]').forEach(function(radio) {
    radio.addEventListener('change', function() {
      var isDelivery = this.value === 'delivery';
      var deliveryFields = document.getElementById('deliveryFields');
      if (deliveryFields) deliveryFields.style.display = isDelivery ? 'block' : 'none';
      var subtotal = cart.reduce(function(acc, item) { return acc + (item.price * (item.quantity || 1)); }, 0);
      updateCartTotals(subtotal);
    });
  });

  // ── Listener: CEP ──
  var cepInput = document.getElementById('customerCep');
  if (cepInput) {
    cepInput.addEventListener('input', function() {
      // Máscara 00000-000
      var v = this.value.replace(/\D/g, '').slice(0, 8);
      this.value = v.length > 5 ? v.slice(0, 5) + '-' + v.slice(5) : v;
      clearFieldError('customerCep');
    });
    cepInput.addEventListener('blur', function() {
      lookupCep(this.value);
    });
  }

  // ── Listener: limpar erros ao digitar ──
  ['customerName', 'customerAddress', 'customerNeighborhood'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.addEventListener('input', function() { clearFieldError(id); });
  });

  // ── Listener: cards de pagamento ──
  document.querySelectorAll('input[name="paymentMethod"]').forEach(function(radio) {
    radio.addEventListener('change', function() {
      var changeWrapper = document.getElementById('changeWrapper');
      var changeResult = document.getElementById('changeResult');
      if (this.value === 'Dinheiro') {
        changeWrapper.style.display = 'block';
      } else {
        changeWrapper.style.display = 'none';
        document.getElementById('cashChange').value = '';
        if (changeResult) changeResult.hidden = true;
      }
    });
  });

  // ── Listener: troco automático ──
  var cashChangeInput = document.getElementById('cashChange');
  if (cashChangeInput) {
    cashChangeInput.addEventListener('input', function() {
      var radioDelivery = document.querySelector('input[name="deliveryOption"]:checked');
      var isDelivery = radioDelivery && radioDelivery.value === 'delivery';
      var subtotal = cart.reduce(function(a, i) { return a + (i.price * (i.quantity || 1)); }, 0);
      var fee = isDelivery ? DELIVERY_FEE : 0;
      var total = subtotal + fee;
      var paid = parseFloat(this.value.replace(',', '.'));
      var changeResult = document.getElementById('changeResult');
      if (changeResult) {
        if (!isNaN(paid) && paid >= total) {
          changeResult.innerText = 'Seu troco: ' + brl(paid - total);
          changeResult.hidden = false;
        } else {
          changeResult.hidden = true;
        }
      }
    });
  }

  // --- BUSINESS INFO ---
  window.aplicarBusinessInfo = function(info) {
    if (!info) return;
    window._businessInfo = info;

    var waUrl = 'https://wa.me/' + (info.whatsappNumber || '');

    // WhatsApp no floatWpp existente
    if (floatWpp) {
      var floatLink = floatWpp.querySelector('a') || floatWpp;
      if (floatLink.href !== undefined) floatLink.href = waUrl;
    }

    // Contato
    var contactPhone = document.getElementById('contact-phone');
    if (contactPhone) {
      contactPhone.textContent = info.phone || info.whatsapp || '';
      contactPhone.href = 'tel:' + (info.phone || info.whatsapp || '').replace(/\D/g, '');
    }

    var contactAddress = document.getElementById('contact-address');
    if (contactAddress) {
      contactAddress.innerHTML = escapeHtml(info.address || '') + '<br>' +
        escapeHtml(info.neighborhood || '') + ' - ' + escapeHtml(info.cityState || '');
    }

    var contactHours = document.getElementById('contact-hours');
    if (contactHours && info.hours) {
      if (info.hours.display) {
        contactHours.innerHTML = info.hours.display;
      } else {
        contactHours.textContent = info.hours.completo || info.hours.funcionamento || '';
      }
    }

    var contactWa = document.getElementById('contact-whatsapp-link');
    if (contactWa) contactWa.href = waUrl;

    var contactIg = document.getElementById('contact-instagram-link');
    if (contactIg && info.instagram) contactIg.href = info.instagram;

    var contactMaps = document.getElementById('contact-maps-link');
    if (contactMaps && info.googleMapsLink) contactMaps.href = info.googleMapsLink;

    var contactMap = document.getElementById('contactMap');
    if (contactMap && info.googleMapsEmbed &&
        info.googleMapsEmbed.indexOf('https://www.google.com/maps') === 0) {
      contactMap.innerHTML = '<iframe src="' + encodeURI(info.googleMapsEmbed) +
        '" width="100%" height="400" style="border:0" allowfullscreen loading="lazy" title="Mapa"></iframe>';
    }

    // Atualiza badge aberto/fechado a partir dos horários
    refreshOpenStatus();
  };

  // Atualizar status a cada minuto
  setInterval(refreshOpenStatus, 60 * 1000);

  // --- PROMO CARDS: mostrar/ocultar botão Pedir conforme o dia ---
  function initPromoCards() {
    var dayMap = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
    var today = dayMap[new Date().getDay()];

    document.querySelectorAll('.promo-card[data-days]').forEach(function(card) {
      var days = card.getAttribute('data-days').split(' ');
      var isTodos = days.indexOf('todos') !== -1;
      var isToday = isTodos || days.indexOf(today) !== -1;

      // Destaca visualmente o card quando é hoje
      if (isToday && !isTodos) {
        card.classList.add('promo-card-hoje');
      }

      // Atualiza a tag do card
      var tag = card.querySelector('.promo-tag[data-tag-label]');
      if (tag && !isTodos) {
        if (isToday) {
          tag.textContent = 'Hoje! 🔥';
          tag.className = 'promo-tag promo-tag-hoje';
        }
        // se não for hoje, mantém o label original (Terça, Quarta, etc.)
      }

      // Habilita/desabilita o botão Pedir
      var btn = card.querySelector('.btn-promo');
      if (btn) {
        if (!isToday) {
          btn.disabled = true;
          btn.title = 'Disponível apenas no dia desta promoção';
          btn.classList.add('btn-promo-off');
        }
      }
    });

    // Esconde o botão hero "Promoções do Dia" se não houver promo ativa hoje
    var heroBtn = document.getElementById('heroDailyPromoBtn');
    if (heroBtn) {
      var hasPromoToday = !!document.querySelector('.promo-card[data-days~="' + today + '"]');
      heroBtn.hidden = !hasPromoToday;
    }
  }

  // --- FEATURES: renderiza siteData.features no bloco "A Pizzaria" ---
  function renderFeatures() {
    var data = (window.siteData && window.siteData.features) || [];
    var el = document.getElementById('featuresList');
    if (!el || !data.length) return;
    // Exibe os primeiros 4 itens (layout suporta 2x2)
    el.innerHTML = data.slice(0, 4).map(function(f) {
      return '<div class="feature-item">' +
        '<div class="feat-icon">' + escapeHtml(f.icon || '🍕') + '</div>' +
        '<div>' +
          '<h4>' + escapeHtml(f.title) + '</h4>' +
          '<span>' + escapeHtml(f.text) + '</span>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  // --- PROMOCOES ---
  window.renderPromocoes = function(data) {
    if (!data) return;
    var dayMap = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
    var today = dayMap[new Date().getDay()];
    var promos = data[today] || [];

    var promoBar = document.getElementById('promoBar');
    if (!promoBar || promos.length === 0) return;

    promoBar.innerHTML = promos.map(function(p) {
      var text = p.texto || p.text || '';
      var isHighlight = p.destaque || p.highlight;
      return '<span class="promo-item' + (isHighlight ? ' promo-highlight' : '') + '">' + escapeHtml(text) + '</span>';
    }).join(' | ');

    promoBar.style.display = 'block';
  };

  // --- CONTROLES GLOBAIS ---
  function closeModal(id) {
    var modal = document.getElementById(id);
    if (!modal) return;
    modal.classList.remove("active");
    document.body.style.overflow = "";
  }

  document.querySelectorAll(".close-modal, .btn-close").forEach(function(btn) {
    btn.addEventListener("click", function() {
      closeModal("pizzaModal");
      closeModal("cartModal");
    });
  });

  document.querySelectorAll(".modal-overlay").forEach(function(overlay) {
    overlay.addEventListener("click", function(e) {
      if(e.target === this) {
        closeModal("pizzaModal");
        closeModal("cartModal");
      }
    });
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      closeModal("pizzaModal");
      closeModal("cartModal");
    }
  });

  function initCarousels() {
    var carousels = document.querySelectorAll('.carousel');
    carousels.forEach(function (root) {
      var slides = root.querySelectorAll('.carousel-slide');
      if (!slides.length) return;
      var dotsWrap = root.querySelector('.carousel-dots');
      var prev = root.querySelector('.carousel-prev');
      var next = root.querySelector('.carousel-next');
      var autoplay = parseInt(root.getAttribute('data-autoplay'), 10) || 0;
      var current = 0;
      var timer = null;

      var dots = [];
      if (dotsWrap) {
        dotsWrap.innerHTML = '';
        for (var i = 0; i < slides.length; i++) {
          var b = document.createElement('button');
          b.type = 'button';
          b.setAttribute('role', 'tab');
          b.setAttribute('aria-label', 'Ir para imagem ' + (i + 1));
          (function (idx) { b.addEventListener('click', function () { go(idx); restart(); }); })(i);
          dotsWrap.appendChild(b);
          dots.push(b);
        }
      }

      function go(idx) {
        current = (idx + slides.length) % slides.length;
        slides.forEach(function (s, i) { s.classList.toggle('active', i === current); });
        dots.forEach(function (d, i) { d.classList.toggle('active', i === current); });
      }
      function nextFn() { go(current + 1); }
      function prevFn() { go(current - 1); }
      function start() { if (autoplay > 0) timer = setInterval(nextFn, autoplay); }
      function stop() { if (timer) { clearInterval(timer); timer = null; } }
      function restart() { stop(); start(); }

      if (prev) prev.addEventListener('click', function () { prevFn(); restart(); });
      if (next) next.addEventListener('click', function () { nextFn(); restart(); });
      root.addEventListener('mouseenter', stop);
      root.addEventListener('mouseleave', start);

      // swipe touch
      var touchX = null;
      root.addEventListener('touchstart', function (e) { touchX = e.touches[0].clientX; }, { passive: true });
      root.addEventListener('touchend', function (e) {
        if (touchX === null) return;
        var dx = e.changedTouches[0].clientX - touchX;
        if (Math.abs(dx) > 40) { (dx < 0 ? nextFn : prevFn)(); restart(); }
        touchX = null;
      });

      go(0);
      start();
    });
  }

  function initReveal() {
    var items = document.querySelectorAll(".reveal:not(.visible)");
    if (!window.IntersectionObserver) {
      items.forEach(function(item){ item.classList.add("visible"); });
      return;
    }
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("visible");
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1, rootMargin: "0px 0px -50px 0px" });
    items.forEach(function (item) { observer.observe(item); });
  }

  function updateHeader() {
    header.classList.toggle("scrolled", window.scrollY > 20);
    var current = window.scrollY + 150;
    sections.forEach(function (section) {
      if (current >= section.offsetTop && current < section.offsetTop + section.offsetHeight) {
        navLinks.forEach(function (link) {
          link.classList.toggle("active", link.dataset.section === section.id);
        });
      }
    });
  }

  mobileToggle.addEventListener("click", function () {
    mobileToggle.classList.toggle("active");
    nav.classList.toggle("mobile-open");
  });

  nav.querySelectorAll("a").forEach(function (link) {
    link.addEventListener("click", function () {
      nav.classList.remove("mobile-open");
      mobileToggle.classList.remove("active");
    });
  });

  // Botao "Promocoes do Dia" na hero -> ativa primeiro tab promo no cardapio
  var heroDailyPromoBtn = document.getElementById('heroDailyPromoBtn');
  if (heroDailyPromoBtn) {
    heroDailyPromoBtn.addEventListener('click', function(e) {
      e.preventDefault();
      var promoTab = document.querySelector('.menu-tab[data-tab="promocao-do-dia"]') || document.querySelector('.menu-tab.menu-tab-promo');
      if (promoTab) {
        var cardapioSection = document.getElementById('cardapio');
        if (cardapioSection) cardapioSection.scrollIntoView({ behavior: 'smooth' });
        setTimeout(function() { promoTab.click(); }, 400);
      } else {
        window.location.href = '#cardapio';
      }
    });
  }

  // Render do feed do Instagram (alimentado pelo cardapio-admin via Firestore)
  window.renderInstagramGrid = function(posts) {
    var grid = document.getElementById('instagramGrid');
    var section = document.getElementById('instagram');
    if (!grid || !Array.isArray(posts) || !posts.length) return;
    var html = '';
    posts.slice(0, 9).forEach(function(post) {
      var img = post.image || post.imageUrl || '';
      var url = post.postUrl || '#';
      var alt = (post.alt || 'Post @wilsonpizzastq').replace(/"/g, '&quot;');
      if (!img) return;
      html += '<a class="ig-item" href="' + url + '" target="_blank" rel="noopener" aria-label="Abrir post no Instagram">';
      html += '<img src="' + img + '" alt="' + alt + '" loading="lazy">';
      html += '</a>';
    });
    grid.innerHTML = html;
    if (section && html) section.hidden = false;
  };

  // Aplicar businessInfo local como fallback
  if (window.businessInfoData) {
    window.aplicarBusinessInfo(window.businessInfoData);
  }

  // Renderizar promocoes locais como fallback
  if (window.promocoesData) {
    window.renderPromocoes(window.promocoesData);
  }

  // Inicializar menu com dados locais
  createMenu();
  initCarousels();
  initReveal();
  updateHeader();
  window.addEventListener("scroll", updateHeader, { passive: true });

  // Mostrar pílula do carrinho se houver itens persistidos
  updateCartUI();

  // Promo cards: habilitar/desabilitar botão Pedir conforme o dia
  initPromoCards();

  // Renderizar features da pizzaria
  renderFeatures();
})();
