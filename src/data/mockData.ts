import { Product, CadenceDay, Objection, Material } from '@/types/sales';

export const mockProducts: Product[] = [
  {
    id: '1',
    name: 'PoupeJá White Label',
    description: 'Plataforma de cashback white label para empresas',
    pitch15s: 'PoupeJá é a plataforma que transforma compras dos tus clientes em pontos e cashback. Tu banco, tu marca, tu lucro.',
    pitch30s: 'Imagine oferecer aos tus clientes um programa de cashback completo, con a tu marca, integrado ao tu app. O PoupeJá White Label faz eso em semanas, no meses. Usted retém mais, engaja mais e lucra mais.',
    pitch2min: 'O PoupeJá White Label é a solución completa para bancos digitais e fintechs que querem oferecer programas de fidelidade de verdade. Cashback em milhares de lojas parceiras, marketplace integrado, tarjeta virtual con benefícios. Tudo eso con tu marca, tu domínio, tus cores. Implementação em 4 semanas, suporte dedicado e modelo de receita transparente. Já operamos con mais de 15 instituições e movimentamos R$ 2M em cashback por mes.',
    icp: 'Fintechs e bancos digitais con base de 10k+ clientes ativos buscando diferenciação e retención',
    differentials: [
      'Implementação em 4 semanas',
      'White label completo',
      '+1.500 lojas parceiras',
      'API robusta e documentada',
      'Suporte dedicado 24/7'
    ],
    pricing: [
      { name: 'Starter', price: 'R$ 2.990/mes', features: ['Até 10k usuarios', 'Cashback básico', 'Suporte email'] },
      { name: 'Growth', price: 'R$ 7.990/mes', features: ['Até 50k usuarios', 'Marketplace completo', 'API avançada', 'Suporte prioritário'], recommended: true },
      { name: 'Enterprise', price: 'Sob consulta', features: ['Usuarios ilimitados', 'Customização total', 'SLA dedicado', 'Account Manager'] }
    ],
    status: 'published',
    createdAt: new Date('2024-01-15'),
    updatedAt: new Date('2024-06-20')
  },
  {
    id: '2',
    name: 'IsiChat WL',
    description: 'Plataforma de atendimento multicanal white label',
    pitch15s: 'IsiChat unifica WhatsApp, Instagram e Telegram em um só lugar. Atenda mais, venda mais.',
    pitch30s: 'Tus clientes estão em todo lugar. WhatsApp, Instagram, Telegram, e-mail. O IsiChat White Label centraliza tudo, con automatizaciones inteligentes, chatbots e reportes. Tu marca, tu plataforma, tu controle total.',
    pitch2min: 'O IsiChat White Label é a plataforma de atendimento omnichannel que tus equipes precisam. Centralize conversas de WhatsApp Business, Instagram DM, Telegram e e-mail. Configure chatbots sin código, crie flujos de automatización, distribua atendimentos entre equipes e acompanhe métricas en tiempo real. Tudo eso con tu identidade visual. Ideal para agências, consultorias e empresas que querem oferecer atendimento profissional aos tus clientes.',
    icp: 'Agências de marketing digital e consultorias con 20+ clientes ativos',
    differentials: [
      'Multicanal real (no é gambiarra)',
      'Chatbot visual drag-and-drop',
      'API oficial do WhatsApp',
      'Reportes de performance',
      'White label completo'
    ],
    pricing: [
      { name: 'Basic', price: 'R$ 497/mes', features: ['3 canais', '5 atendentes', 'Chatbot básico'] },
      { name: 'Pro', price: 'R$ 1.297/mes', features: ['Canais ilimitados', '20 atendentes', 'Automatizaciones avançadas', 'API'], recommended: true },
      { name: 'Agency', price: 'R$ 2.997/mes', features: ['Multi-clientes', 'Atendentes ilimitados', 'White label', 'Revenda'] }
    ],
    status: 'published',
    createdAt: new Date('2024-02-10'),
    updatedAt: new Date('2024-06-18')
  },
  {
    id: '3',
    name: 'TucaPay',
    description: 'Gateway de pagamentos con split automático',
    pitch15s: 'TucaPay: receba pagamentos, divida automaticamente entre parceiros. Simples assim.',
    pitch30s: 'Marketplaces, franquias, afiliados. Se usted precisa dividir pagamentos de forma automática, o TucaPay resolve. PIX, tarjeta, boleto con split configurável. Usted define as regras, a grana vai pro lugar certo.',
    pitch2min: 'O TucaPay é o gateway de pagamentos pensado para quem precisa de split automático. Ideal para marketplaces, programas de afiliados, franquias e cualquier modelo con múltiples recebedores. Configure splits fixos ou variables, receba em PIX instantâneo, tarjeta ou boleto. Dashboard completo, conciliação automática e antecipação de recebíveis. Integración simples via API REST con SDKs para as principais linguagens. Taxas competitivas e suporte técnico de verdade.',
    icp: 'Marketplaces e plataformas con modelo de comissionamento ou split de pagamentos',
    differentials: [
      'Split automático configurável',
      'PIX instantâneo',
      'Antecipação de recebíveis',
      'Dashboard de conciliação',
      'API REST moderna'
    ],
    pricing: [
      { name: 'Transacional', price: '2.99% + R$0.49', features: ['PIX', 'Tarjeta', 'Boleto', 'Split básico'] },
      { name: 'Business', price: '2.49% + R$0.39', features: ['Tudo do Transacional', 'Antecipação', 'Conciliação avançada', 'API priority'], recommended: true },
      { name: 'Enterprise', price: 'Negociável', features: ['Taxas personalizadas', 'SLA dedicado', 'Integración assistida'] }
    ],
    status: 'published',
    createdAt: new Date('2024-03-05'),
    updatedAt: new Date('2024-06-15')
  }
];

export const mockCadence: CadenceDay[] = [
  {
    day: 1,
    title: 'Primera Abordagem',
    trigger: 'Apresentar valor + crear curiosidade',
    blocks: [
      {
        id: '1-1',
        type: 'message',
        variant: 'short',
        content: 'Oi [NOME]! 👋 Vi que usted trabalha con [SEGMENTO]. Tengo algo que puede dobrar a retención dos tus clientes. Posso te mostrar em 2 minutos?'
      },
      {
        id: '1-2',
        type: 'message',
        variant: 'medium',
        content: 'Oi [NOME], tudo bem? 👋\n\nMe chamo [SEU NOME] e trabajo con soluciones de cashback para fintechs como a tu.\n\nTemos uma plataforma white label que já ajudou +15 bancos digitais a aumentarem a retención em 40%.\n\nVocês já têm alguma solución de fidelidade rodando? Queria entender mejor o cenário de ustedes.'
      },
      {
        id: '1-3',
        type: 'audio',
        variant: 'short',
        content: 'Audio de presentación (20s)',
        audioScript: 'Oi [NOME], acá é o [SEU NOME]. Trabajo con soluciones de cashback white label pra fintechs. Já ajudamos mais de 15 bancos digitais a aumentar retención em 40%. Queria bater um papo rápido pra entender o cenário de ustedes. Me dá um retorno?'
      }
    ]
  },
  {
    day: 2,
    title: 'Prova Social',
    trigger: 'Mostrar resultados reais + quebrar ceticismo',
    blocks: [
      {
        id: '2-1',
        type: 'message',
        variant: 'short',
        content: '[NOME], olha ese case: Banco XYZ aumentou 47% de retención em 3 meses con nossa plataforma. Quer ver os números?'
      },
      {
        id: '2-2',
        type: 'message',
        variant: 'medium',
        content: '[NOME], queria compartir um resultado que acho relevante pro tu contexto:\n\n📊 O Banco XYZ tinha 22% de churn mensual\n📊 Implementaram nosso cashback white label\n📊 Em 3 meses: churn caiu pra 12%\n📊 ROI do programa: 340%\n\nPosso te mandar o case completo?'
      },
      {
        id: '2-3',
        type: 'material',
        variant: 'short',
        content: 'Case Study: Banco XYZ',
        materialId: 'case-xyz'
      }
    ]
  },
  {
    day: 3,
    title: 'Comparativo',
    trigger: 'Ancorar valor vs alternativas',
    blocks: [
      {
        id: '3-1',
        type: 'message',
        variant: 'medium',
        content: '[NOME], sei que existem otras opciones no mercado. Fiz uma comparação rápida:\n\n🔴 Desenvolver interno: 6-12 meses + R$500k\n🔴 Concorrente A: 3 meses + sin white label\n🟢 PoupeJá: 4 semanas + white label completo\n\nQual dessas opciones ustedes estavam considerando?'
      },
      {
        id: '3-2',
        type: 'cta',
        variant: 'short',
        content: 'Agendar demo de 15 minutos'
      }
    ]
  },
  {
    day: 4,
    title: 'Escassez + Bônus',
    trigger: 'Crear urgência legítima',
    blocks: [
      {
        id: '4-1',
        type: 'message',
        variant: 'medium',
        content: '[NOME], temos uma condición especial até sexta:\n\n🎁 Setup gratuito (economia de R$5.000)\n🎁 1 mes free pra testar\n🎁 Migración assistida\n\nIsso vale pros próximos 3 contratos. Faz sentido a gente conversar aún esa semana?'
      },
      {
        id: '4-2',
        type: 'audio',
        variant: 'short',
        content: 'Audio de urgência',
        audioScript: 'Oi [NOME], passando acá porque temos uma condición especial que vai até sexta: setup gratuito mais um mes free. Só pros próximos 3 contratos. Queria ver se faz sentido pra ustedes entrarem nessa.'
      }
    ]
  },
  {
    day: 5,
    title: 'Última Chamada',
    trigger: 'Fechamento ou call',
    blocks: [
      {
        id: '5-1',
        type: 'message',
        variant: 'short',
        content: '[NOME], última tentativa: posso te ligar 5 minutos amanhã às 10h ou 15h? Se no der, sin problemas, fico no tu radar.'
      },
      {
        id: '5-2',
        type: 'message',
        variant: 'medium',
        content: '[NOME], entendo que o timing puede no ser ahora.\n\nSe fizer sentido no futuro, fico à disposição. Só me chama.\n\nEnquanto eso, vou te mandar um material sobre tendências de fidelização pra 2024. Acho que agrega valor independente de fecharmos ahora.\n\nAbraço! 🤝'
      }
    ]
  }
];

export const mockObjections: Objection[] = [
  {
    id: 'obj-1',
    category: 'price',
    whatTheySay: 'Está mucho caro',
    whatTheyMean: 'No entendi o valor ou estou comparando con algo diferente',
    suggestedResponse: 'Entendo a preocupação con investimento. Me ajuda a entender: usted está comparando con desenvolver internamente ou con otra solución do mercado?',
    followUpQuestion: 'Quanto ustedes estimam que perdem por mes con churn de clientes?'
  },
  {
    id: 'obj-2',
    category: 'timing',
    whatTheySay: 'No é o momento certo',
    whatTheyMean: 'Tengo otras prioridades ou preciso de mais informaciones',
    suggestedResponse: 'Faz total sentido priorizar. Posso perguntar: o que precisaria mudar pro momento ficar certo? É questão de budget, time interno ou estratégia?',
    followUpQuestion: 'Ustedes têm uma data específica em mente pra revisitar eso?'
  },
  {
    id: 'obj-3',
    category: 'thinking',
    whatTheySay: 'Preciso pensar / consultar',
    whatTheyMean: 'Preciso de mais segurança ou no sou o decisor',
    suggestedResponse: 'Claro! Pra te ajudar a pensar: qual é a principal dúvida que ficou? Posso preparar um material mais específico sobre ese ponto.',
    followUpQuestion: 'Quem mais estaria envolvido nessa decisión? Posso agendar uma call con todo mundo junto?'
  },
  {
    id: 'obj-4',
    category: 'competitor',
    whatTheySay: 'Já uso otra solución',
    whatTheyMean: 'Preciso de um motivo forte pra mudar',
    suggestedResponse: 'Ótimo que ustedes já têm algo rodando! Qual solución ustedes usam? Pergunto porque muitos clientes nossos migraram de [X/Y/Z] por causa de [diferencial específico].',
    followUpQuestion: 'O que usted mudaria na solución actual se pudesse?'
  },
  {
    id: 'obj-5',
    category: 'trust',
    whatTheySay: 'Nunca ouvi falar de ustedes',
    whatTheyMean: 'Preciso de prova de que funciona e é seguro',
    suggestedResponse: 'Faz sentido! Somos mais discretos porque trabalhamos B2B. Posso te mandar nosso case con [Cliente Referencia] e también te colocar em contato con um cliente nosso pra usted ouvir direto deles.',
    followUpQuestion: 'Prefere que eu mande cases por escrito ou um contato direto con cliente?'
  },
  {
    id: 'obj-6',
    category: 'partner',
    whatTheySay: 'Preciso falar con meu sócio/diretor',
    whatTheyMean: 'No tengo autonomia total ou preciso de apoio',
    suggestedResponse: 'Perfeito! Quer que eu prepare um resumo executivo pra facilitar a conversa con ele? Ou mejor: posso entrar na call junto pra responder perguntas técnicas?',
    followUpQuestion: 'Cuando ustedes teriam esa conversa? Posso ligar después pra tirar dúvidas que surgirem?'
  }
];

export const mockMaterials: Material[] = [
  {
    id: 'case-xyz',
    name: 'Case Study: Banco XYZ',
    type: 'pdf',
    url: '/materials/case-xyz.pdf',
    tags: ['proof'],
    objective: 'Mostrar resultados reais de implementação',
    status: 'active'
  },
  {
    id: 'demo-video',
    name: 'Vídeo Demo - Plataforma',
    type: 'video',
    url: 'https://youtube.com/demo',
    tags: ['presentation'],
    objective: 'Demonstrar funcionalidades principais',
    status: 'active'
  },
  {
    id: 'comparison-table',
    name: 'Comparativo de Mercado',
    type: 'pdf',
    url: '/materials/comparison.pdf',
    tags: ['objection', 'closing'],
    objective: 'Diferenciar de concorrentes',
    status: 'active'
  },
  {
    id: 'roi-calculator',
    name: 'Calculadora de ROI',
    type: 'link',
    url: 'https://app.poupeja.com/roi',
    tags: ['closing'],
    objective: 'Justificar investimento',
    status: 'active'
  },
  {
    id: 'testimonial-1',
    name: 'Depoimento - CEO Fintech Alpha',
    type: 'video',
    url: 'https://youtube.com/testimonial1',
    tags: ['proof'],
    objective: 'Prova social de decisor',
    status: 'active'
  },
  {
    id: 'banner-promo',
    name: 'Banner Promoção Q3',
    type: 'banner',
    url: '/materials/promo-q3.png',
    tags: ['closing'],
    objective: 'Destacar oferta especial',
    status: 'active'
  }
];
