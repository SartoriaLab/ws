/**
 * sync-eatfood.js — Sincroniza cardapio do EatFood com o Firestore (cardapio-admin)
 *
 * Estrategia: merge inteligente
 *   - Atualiza nome, desc, preco de itens existentes
 *   - Adiciona novos itens do EatFood com ativo:true, tags:[]
 *   - Itens removidos do EatFood ficam com ativo:false (preservados)
 *   - Preserva: tags, ativo (se o admin inativou um item, continua inativo)
 *   - Novas abas do EatFood sao adicionadas
 *
 * Pre-requisitos:
 *   1. npm install
 *   2. Copiar serviceAccountProd.json do projeto cardapio-admin para esta pasta
 *
 * Uso:
 *   node scripts/sync-eatfood.js
 *
 * Para sincronizacao periodica (Windows Task Scheduler):
 *   Programa: node
 *   Argumentos: "C:\dev\prototipos\pizza kid\scripts\sync-eatfood.js"
 *   Trigger: Diario, semanal, etc.
 */

var https = require('https');
var admin = require('firebase-admin');
var path = require('path');
var fs = require('fs');

var SLUG = 'wilsons-pizzaria';
var PROJECT = 'cardapio-admin-prod';
var EATFOOD_URL = 'https://apionline.com.br:8443/v1/carganome/wilsonspizzastaquaritinga';
var SERVICE_ACCOUNT_PATH = path.join(__dirname, '..', 'serviceAccountProd.json');

// --- Verifica service account ---
if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
  console.error('ERRO: serviceAccountProd.json nao encontrado em ' + SERVICE_ACCOUNT_PATH);
  console.error('Copie o arquivo de: C:\\dev\\cardapio-admin\\serviceAccountProd.json');
  process.exit(1);
}

// --- Firebase Admin ---
var serviceAccount = require(SERVICE_ACCOUNT_PATH);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
var db = admin.firestore();

// --- Helpers ---

function toTitleCase(str) {
  return str
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map(function(word) {
      if (!word) return word;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

function slugify(str) {
  return str
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function cleanName(nome) {
  return nome.replace(/\s{2,}/g, ' ').trim();
}

// --- Fetch EatFood ---
function fetchEatFood() {
  return new Promise(function(resolve, reject) {
    https.get(EATFOOD_URL, function(res) {
      var body = '';
      res.on('data', function(chunk) { body += chunk; });
      res.on('end', function() {
        try {
          var data = JSON.parse(body);
          resolve(Array.isArray(data) ? data[0] : data);
        } catch(e) {
          reject(new Error('Falha ao parsear resposta do EatFood: ' + e.message));
        }
      });
    }).on('error', reject);
  });
}

// --- Converter EatFood -> formato cardapio-admin ---
function converterEatFood(store) {
  var tipos = store.tipo || [];
  return tipos.map(function(tipo) {
    var label = toTitleCase(tipo.tipo || 'Sem Nome');
    var id = slugify(label);
    var produtos = tipo.produto || [];

    var itens = produtos.map(function(p) {
      var precoBase = p.valor || 0;
      var precoPromo = (typeof p.valor_online_promocao === 'number' && p.valor_online_promocao > 0)
        ? p.valor_online_promocao : null;
      var emPromocao = !!precoPromo && (p.promocao_online === 'S' || p.ativarpromo === 'S');
      var item = {
        nome: cleanName(p.produto || ''),
        desc: (p.descricao || '').trim(),
        preco: emPromocao ? precoPromo : precoBase,
        imagem: (p.img || '').trim(),
        ativo: p.exibir === 'S',
        tags: []
      };
      if (emPromocao) {
        item.precoOriginal = precoBase;
        item.emPromocao = true;
      }
      return item;
    });

    return {
      id: id,
      label: label,
      ativo: tipo.exibir === 'S',
      divisao: tipo.divisao || 0,
      categorias: [{
        titulo: label,
        nota: '',
        ativo: true,
        itens: itens
      }]
    };
  });
}

// --- Merge inteligente ---
function mergeCardapio(atual, novo) {
  // Mapas por id para busca rapida
  var mapaAtual = {};
  (atual || []).forEach(function(tab) {
    mapaAtual[tab.id] = tab;
  });

  var mapaItensAtuais = {}; // tabId -> { nome -> item }
  (atual || []).forEach(function(tab) {
    mapaItensAtuais[tab.id] = {};
    (tab.categorias || []).forEach(function(cat) {
      (cat.itens || []).forEach(function(item) {
        mapaItensAtuais[tab.id][item.nome] = item;
      });
    });
  });

  var stats = { adicionados: 0, atualizados: 0, inativados: 0, abas_novas: 0 };

  var resultado = novo.map(function(tabNova) {
    var tabAtual = mapaAtual[tabNova.id];
    var itensAtuais = mapaItensAtuais[tabNova.id] || {};

    if (!tabAtual) {
      stats.abas_novas++;
      stats.adicionados += tabNova.categorias[0].itens.length;
      return tabNova;
    }

    // Merge dos itens
    var nomesNovos = {};
    var itensMergeados = tabNova.categorias[0].itens.map(function(itemNovo) {
      nomesNovos[itemNovo.nome] = true;
      var itemAtual = itensAtuais[itemNovo.nome];

      if (!itemAtual) {
        stats.adicionados++;
        return itemNovo;
      }

      // Preserva: ativo (do admin), tags (do admin)
      // Atualiza: preco, desc, imagem, promo do EatFood
      stats.atualizados++;
      var merged = {
        nome: itemNovo.nome,
        desc: itemNovo.desc,
        preco: itemNovo.preco,
        imagem: itemNovo.imagem || itemAtual.imagem || '',
        ativo: itemAtual.ativo,  // preserva decisao do admin
        tags: itemAtual.tags || []  // preserva tags do admin
      };
      if (itemNovo.emPromocao) {
        merged.emPromocao = true;
        merged.precoOriginal = itemNovo.precoOriginal;
      }
      return merged;
    });

    // Itens que existiam no admin mas foram removidos do EatFood -> inativar
    Object.keys(itensAtuais).forEach(function(nome) {
      if (!nomesNovos[nome]) {
        var item = itensAtuais[nome];
        if (item.ativo !== false) {
          stats.inativados++;
          itensMergeados.push(Object.assign({}, item, { ativo: false }));
        } else {
          itensMergeados.push(item);
        }
      }
    });

    return {
      id: tabNova.id,
      label: tabNova.label,
      ativo: tabAtual.ativo !== undefined ? tabAtual.ativo : tabNova.ativo,
      categorias: [{
        titulo: tabNova.categorias[0].titulo,
        nota: tabAtual.categorias && tabAtual.categorias[0] ? (tabAtual.categorias[0].nota || '') : '',
        ativo: tabAtual.categorias && tabAtual.categorias[0] ? (tabAtual.categorias[0].ativo !== false) : true,
        itens: itensMergeados
      }]
    };
  });

  // Abas que existem no admin mas nao estao mais no EatFood -> manter
  Object.keys(mapaAtual).forEach(function(id) {
    var jaEsta = resultado.some(function(t) { return t.id === id; });
    if (!jaEsta) {
      resultado.push(mapaAtual[id]);
    }
  });

  return { cardapio: resultado, stats: stats };
}

// --- Main ---
async function run() {
  console.log('Buscando dados do EatFood...');
  var store;
  try {
    store = await fetchEatFood();
    console.log('EatFood: ' + (store.tipo || []).length + ' categorias encontradas');
  } catch(e) {
    console.error('ERRO ao buscar EatFood:', e.message);
    process.exit(1);
  }

  var cardapioNovo = converterEatFood(store);

  var docRef = db.collection('restaurants').doc(SLUG).collection('data').doc('cardapio');
  var docSnap = await docRef.get();
  var cardapioAtual = null;

  if (docSnap.exists) {
    var raw = docSnap.data();
    cardapioAtual = raw.content || null;
    console.log('Cardapio atual no Firestore: ' + (cardapioAtual ? (cardapioAtual.length + ' abas') : 'vazio'));
  } else {
    console.log('Nenhum cardapio no Firestore ainda (primeiro upload)');
  }

  var merged = mergeCardapio(cardapioAtual, cardapioNovo);
  var stats = merged.stats;

  await docRef.set({
    content: merged.cardapio,
    updatedAt: new Date().toISOString()
  });

  console.log('');
  console.log('Cardapio sincronizado com sucesso!');
  console.log('  Abas novas: ' + stats.abas_novas);
  console.log('  Itens adicionados: ' + stats.adicionados);
  console.log('  Itens atualizados (preco/desc): ' + stats.atualizados);
  console.log('  Itens inativados (removidos do EatFood): ' + stats.inativados);
  console.log('  Total de abas: ' + merged.cardapio.length);

  // Primeiro upload: sobe tambem businessInfo e promocoes
  if (!docSnap.exists) {
    console.log('');
    console.log('Primeiro upload — enviando businessInfo e promocoes...');

    var businessInfo = {
      name: "Wilson's Pizzaria",
      city: 'Taquaritinga - SP',
      slogan: 'A pizza mais RECHEADA da região',
      tagline: 'A mais RECHEADA da cidade',
      whatsapp: '(16) 99738-4914',
      whatsappNumber: '5516997384914',
      phone: '(16) 3253-3541',
      phone2: '(16) 3253-6523',
      address: 'Av. Caetano Decaro, 551',
      neighborhood: 'Laranjeiras',
      cityState: 'Taquaritinga - SP',
      cep: '15900-000',
      instagram: 'https://www.instagram.com/wilsonpizzastq',
      facebook: 'https://www.facebook.com/wilsonspizzastaquaritinga',
      googleMapsLink: 'https://www.google.com/maps/search/?api=1&query=Wilson%27s+Pizzaria+Taquaritinga',
      googleMapsEmbed: '',
      hours: {
        funcionamento: 'Segunda a Sábado',
        jantar: 'A partir das 17h30 (Sáb até 23h30)',
        almoco: '',
        completo: (store.dia || []).map(function(d) {
          var n = ['', 'Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'];
          return n[d.dia] + ' ' + d.de + '-' + d.ate;
        }).join(' | ')
      }
    };

    var promocoes = {
      domingo: [], segunda: [], terca: [], quarta: [],
      quinta: [], sexta: [], sabado: []
    };

    var base = db.collection('restaurants').doc(SLUG).collection('data');
    await base.doc('businessInfo').set({ content: businessInfo, updatedAt: new Date().toISOString() });
    await base.doc('promocoes').set({ content: promocoes, updatedAt: new Date().toISOString() });
    console.log('businessInfo e promocoes enviados!');
  }

  console.log('');
  console.log('Feito!');
  process.exit(0);
}

run().catch(function(err) {
  console.error('Erro:', err);
  process.exit(1);
});
