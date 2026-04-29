// Fallback local — usado se Firestore falhar.
// businessInfo real vive em restaurants/wilsons-pizzaria/data/businessInfo.
var siteData = {
  business: {
    name: "Wilson's Pizzaria",
    city: 'Taquaritinga - SP',
    slogan: 'A pizza mais RECHEADA da região',
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
    hours: {
      funcionamento: 'Segunda a Sábado',
      jantar: 'A partir das 17h30',
      completo: 'Seg-Sex 17:30-23:00 | Sáb 17:30-23:30 | Dom Fechado'
    }
  },
  promoDay: {
    domingo: [], segunda: [], terca: [], quarta: [],
    quinta: [], sexta: [], sabado: []
  }
};
