import { FunnelBlock, generateBlockId } from '@/types/funnel';

export type QuizCategory = 'captacao' | 'diagnostico' | 'negocios' | 'nichos' | 'qualificacao' | 'recomendacao' | 'educacional';
export type QuizBadge = 'mais-usado' | 'recomendado' | 'alta-conversao' | 'diagnostico' | 'evento' | 'nicho' | 'ia';

export interface QuizTemplate {
  id: string;
  name: string;
  description: string;
  category: QuizCategory;
  objective?: string;
  icon: string;
  cover_gradient: string;
  estimated_time: string;
  question_count: number;
  flow_blocks: FunnelBlock[];
  badges?: QuizBadge[];
}

// ───────────── Helpers ─────────────
const block = (type: string, data: any): FunnelBlock => ({
  id: generateBlockId(),
  type: type as any,
  position: { x: 0, y: 0 },
  next_block_id: null,
  data,
});

function chain(...blocks: FunnelBlock[]): FunnelBlock[] {
  for (let i = 0; i < blocks.length - 1; i++) blocks[i].next_block_id = blocks[i + 1].id;
  return blocks;
}

const STD_TIERS_3 = (labels: [string, string, string], colors: [string, string, string], msgs: [string, string, string]) => ([
  { id: 't1', label: labels[0], min: 0, max: 40, color: colors[0], message: msgs[0] },
  { id: 't2', label: labels[1], min: 41, max: 80, color: colors[1], message: msgs[1] },
  { id: 't3', label: labels[2], min: 81, max: 200, color: colors[2], message: msgs[2] },
]);

const captureName = () => block('input', { label: 'Qual tu nome?', placeholder: 'Tu nome', variable_name: 'nome', input_type: 'text', required: true });
const captureWhatsapp = () => block('input', { label: 'Qual tu WhatsApp?', placeholder: '(11) 99999-9999', variable_name: 'whatsapp', input_type: 'phone', required: true });
const captureEmail = () => block('input', { label: 'Qual tu e-mail?', placeholder: 'voce@email.com', variable_name: 'email', input_type: 'email', required: true });

// ───────────── CAPTAÇÃO ─────────────
function tplCapturaSimples() {
  return chain(
    block('text', { content: '👋 Em 30 segundos vamos te conectar con a mejor solución pra usted.' }),
    captureName(),
    captureWhatsapp(),
    block('buttons', {
      label: 'Qual tu principal interesse?',
      variable_name: 'interesse',
      options: [
        { id: '1', letter: 'A', label: 'Quero conhecer mejor', score: 10, tag: 'curioso' },
        { id: '2', letter: 'B', label: 'Quero comprar ahora', score: 30, tag: 'quente' },
        { id: '3', letter: 'C', label: 'Quero pesquisar mais', score: 5, tag: 'frio' },
      ],
    }),
    block('end', {
      content: '✅ Recebemos tu contato! Em breve falaremos con usted.',
      result_tiers: STD_TIERS_3(['Frio', 'Morno', 'Quente'], ['#94a3b8', '#3b82f6', '#ef4444'],
        ['Vamos te nutrir con contenido.', 'Vamos conversar em breve.', 'Um especialista entrará em contato hoje!']),
    }),
  );
}

function tplListaEspera() {
  return chain(
    block('text', { content: '🚀 Entre na lista de espera VIP e seja o primero a saber do lançamento!' }),
    captureName(),
    captureWhatsapp(),
    captureEmail(),
    block('buttons', {
      label: 'O que mais te interessa?',
      variable_name: 'interesse',
      options: [
        { id: '1', letter: 'A', label: 'Precio promocional de lançamento', score: 15, tag: 'preco' },
        { id: '2', letter: 'B', label: 'Acesso antecipado', score: 25, tag: 'antecipado' },
        { id: '3', letter: 'C', label: 'Contenido exclusivo', score: 10, tag: 'conteudo' },
      ],
    }),
    block('buttons', {
      label: 'Qual tu maior expectativa?',
      variable_name: 'expectativa',
      options: [
        { id: '1', letter: 'A', label: 'Resolver um problema actual', score: 25 },
        { id: '2', letter: 'B', label: 'Melhorar o que já faço', score: 20 },
        { id: '3', letter: 'C', label: 'Aprender algo novo', score: 10 },
      ],
    }),
    block('end', {
      content: '🎉 Usted entrou na lista de espera VIP!',
      result_tiers: STD_TIERS_3(['Curioso', 'Interessado', 'Pronto'], ['#94a3b8', '#3b82f6', '#10b981'],
        ['Vamos te manter informado.', 'Aguarde novidades em breve.', 'Vamos te dar acesso antecipado!']),
    }),
  );
}

function tplEvento() {
  return chain(
    block('text', { content: '🎟️ Garanta tu vaga e personalize tu experiencia no evento!' }),
    captureName(),
    captureWhatsapp(),
    block('buttons', {
      label: 'Usted já trabaja con o tema do evento?',
      variable_name: 'experiencia',
      options: [
        { id: '1', letter: 'A', label: 'Sim, atuo há mais de 1 ano', score: 30, tag: 'avancado' },
        { id: '2', letter: 'B', label: 'Estou começando', score: 15, tag: 'iniciante' },
        { id: '3', letter: 'C', label: 'Aún no, quero aprender', score: 5, tag: 'curioso' },
      ],
    }),
    block('buttons', {
      label: 'Qual tu maior desafio hoje?',
      variable_name: 'desafio',
      options: [
        { id: '1', letter: 'A', label: 'Encontrar clientes', score: 20, tag: 'desafio-clientes' },
        { id: '2', letter: 'B', label: 'Escalar a operación', score: 25, tag: 'desafio-escala' },
        { id: '3', letter: 'C', label: 'Aumentar conversión', score: 25, tag: 'desafio-conversao' },
      ],
    }),
    block('buttons', {
      label: 'Qual tu nível de urgência?',
      variable_name: 'urgencia',
      options: [
        { id: '1', letter: 'A', label: 'Preciso resolver já', score: 35, tag: 'urgente' },
        { id: '2', letter: 'B', label: 'Próximos 30 dias', score: 20 },
        { id: '3', letter: 'C', label: 'Sin urgência', score: 5 },
      ],
    }),
    block('end', {
      content: '✅ Vaga garantida! Em breve enviaremos os detalles.',
      result_tiers: STD_TIERS_3(['Curioso', 'Engajado', 'Prioridade'], ['#94a3b8', '#3b82f6', '#ef4444'],
        ['Vamos te preparar para o evento.', 'Contenido pré-evento personalizado.', 'Atención VIP no dia!']),
    }),
  );
}

// ───────────── DIAGNÓSTICO ─────────────
function tplDiagnosticoComercial() {
  return chain(
    block('text', { content: '🎯 Em 60 segundos, vamos diagnosticar tu operación comercial.' }),
    block('buttons', { label: 'Possui processo comercial definido?', variable_name: 'processo',
      options: [
        { id: '1', letter: 'A', label: 'No, é tudo no improviso', score: 5 },
        { id: '2', letter: 'B', label: 'Tengo parcialmente', score: 15 },
        { id: '3', letter: 'C', label: 'Sim, mucho bem definido', score: 30, tag: 'processo-ok' },
      ] }),
    block('buttons', { label: 'Quantos leads recebe por mes?', variable_name: 'leads',
      options: [
        { id: '1', letter: 'A', label: 'Até 50', score: 5 },
        { id: '2', letter: 'B', label: '50 a 300', score: 15 },
        { id: '3', letter: 'C', label: 'Mais de 300', score: 30, tag: 'volume-alto' },
      ] }),
    block('buttons', { label: 'Usa CRM?', variable_name: 'crm',
      options: [
        { id: '1', letter: 'A', label: 'No', score: 0 },
        { id: '2', letter: 'B', label: 'Sim, planilla', score: 10 },
        { id: '3', letter: 'C', label: 'Sim, ferramenta dedicada', score: 25, tag: 'crm-ok' },
      ] }),
    block('buttons', { label: 'Faz follow-up estruturado?', variable_name: 'followup',
      options: [
        { id: '1', letter: 'A', label: 'No', score: 0, tag: 'precisa-cadencia' },
        { id: '2', letter: 'B', label: 'Manual', score: 15 },
        { id: '3', letter: 'C', label: 'Automatizado', score: 30 },
      ] }),
    captureName(), captureWhatsapp(),
    block('end', {
      content: '🎯 Tu diagnóstico está pronto!',
      result_tiers: STD_TIERS_3(
        ['Comercial Desorganizado', 'Comercial em Construção', 'Comercial Pronto p/ Escalar'],
        ['#f97316', '#3b82f6', '#10b981'],
        ['Vamos estruturar o básico para destravar resultados.',
          'Usted está no camino — pequenos ajustes liberam grande crescimento.',
          'Excelente maturidade. Hora de otimizar e escalar.'],
      ),
    }),
  );
}

function tplDiagnosticoAgencia() {
  return chain(
    block('text', { content: '🏢 Diagnóstico rápido da tu agência.' }),
    block('buttons', { label: 'Quantos clientes ativos?', variable_name: 'clientes',
      options: [
        { id: '1', letter: 'A', label: 'Até 5', score: 10 },
        { id: '2', letter: 'B', label: '6 a 20', score: 25 },
        { id: '3', letter: 'C', label: 'Mais de 20', score: 35, tag: 'agencia-grande' },
      ] }),
    block('buttons', { label: 'Vende projeto ou mensalidade?', variable_name: 'modelo',
      options: [
        { id: '1', letter: 'A', label: 'Só projeto', score: 10 },
        { id: '2', letter: 'B', label: 'Mensalidade', score: 25, tag: 'recorrencia' },
        { id: '3', letter: 'C', label: 'Híbrido', score: 20 },
      ] }),
    block('buttons', { label: 'Operación depende de usted?', variable_name: 'dependencia',
      options: [
        { id: '1', letter: 'A', label: 'Sim, totalmente', score: 5, tag: 'gargalo-fundador' },
        { id: '2', letter: 'B', label: 'Parcialmente', score: 15 },
        { id: '3', letter: 'C', label: 'No, equipe roda', score: 30 },
      ] }),
    block('buttons', { label: 'Tem equipe estruturada?', variable_name: 'equipe',
      options: [
        { id: '1', letter: 'A', label: 'Sou solo', score: 5 },
        { id: '2', letter: 'B', label: 'Até 5 pessoas', score: 20 },
        { id: '3', letter: 'C', label: '6+ pessoas', score: 30 },
      ] }),
    captureName(), captureWhatsapp(),
    block('end', {
      content: '🏢 Diagnóstico da agência pronto!',
      result_tiers: STD_TIERS_3(
        ['Agência Operacional', 'Agência em Transición', 'Agência Pronta para Plataforma'],
        ['#f97316', '#3b82f6', '#10b981'],
        ['Foco em construir processos.', 'Estruturando recorrência e equipe.', 'Pronta para escalar con plataforma.'],
      ),
    }),
  );
}

function tplDiagnosticoMarketing() {
  return chain(
    block('text', { content: '📊 Vamos avaliar tu maturidade de marketing.' }),
    block('buttons', { label: 'Usted anuncia hoje?', variable_name: 'anuncios',
      options: [
        { id: '1', letter: 'A', label: 'No', score: 0 },
        { id: '2', letter: 'B', label: 'Pouco', score: 10 },
        { id: '3', letter: 'C', label: 'Sim, con gestor', score: 25, tag: 'trafego-ativo' },
      ] }),
    block('buttons', { label: 'Tem página de captura?', variable_name: 'lp',
      options: [
        { id: '1', letter: 'A', label: 'No', score: 0 },
        { id: '2', letter: 'B', label: 'Tengo uma', score: 15 },
        { id: '3', letter: 'C', label: 'Várias, otimizadas', score: 30 },
      ] }),
    block('buttons', { label: 'Tem automatización de follow-up?', variable_name: 'automacao',
      options: [
        { id: '1', letter: 'A', label: 'No', score: 0, tag: 'precisa-automacao' },
        { id: '2', letter: 'B', label: 'E-mail básico', score: 15 },
        { id: '3', letter: 'C', label: 'Cadência multicanal', score: 30 },
      ] }),
    block('buttons', { label: 'Mede conversión?', variable_name: 'metrica',
      options: [
        { id: '1', letter: 'A', label: 'No', score: 0 },
        { id: '2', letter: 'B', label: 'Planillas', score: 10 },
        { id: '3', letter: 'C', label: 'Dashboard en tiempo real', score: 25 },
      ] }),
    captureName(), captureWhatsapp(),
    block('end', {
      content: '📊 Resultado do diagnóstico de marketing.',
      result_tiers: STD_TIERS_3(
        ['Marketing Inicial', 'Marketing Intermediário', 'Marketing Estruturado'],
        ['#f97316', '#3b82f6', '#10b981'],
        ['Começando a estruturar canais.', 'Já capta, falta automatización.', 'Operación pronta para escala paga.'],
      ),
    }),
  );
}

// ───────────── NEGÓCIOS ─────────────
function tplEmpresarial() {
  return chain(
    block('text', { content: '💼 Em 1 minuto vamos entender a maturidade do tu negocio.' }),
    block('buttons', { label: 'Qual tu faturamento mensual?', variable_name: 'faturamento',
      options: [
        { id: '1', letter: 'A', label: 'Até ₲ 10k', score: 5 },
        { id: '2', letter: 'B', label: '₲ 10k a ₲ 50k', score: 15 },
        { id: '3', letter: 'C', label: '₲ 50k a ₲ 200k', score: 25 },
        { id: '4', letter: 'D', label: 'Acima de ₲ 200k', score: 35, tag: 'faixa-premium' },
      ] }),
    block('buttons', { label: 'Tamaño da equipe?', variable_name: 'equipe',
      options: [
        { id: '1', letter: 'A', label: 'Só eu', score: 5 },
        { id: '2', letter: 'B', label: '2 a 10', score: 20 },
        { id: '3', letter: 'C', label: '11+', score: 30 },
      ] }),
    block('buttons', { label: 'Vende recorrência?', variable_name: 'recorrencia',
      options: [
        { id: '1', letter: 'A', label: 'No', score: 5 },
        { id: '2', letter: 'B', label: 'Em parte', score: 15 },
        { id: '3', letter: 'C', label: 'Modelo principal', score: 25, tag: 'recorrencia' },
      ] }),
    block('buttons', { label: 'Qual tu meta nos próximos meses?', variable_name: 'meta',
      options: [
        { id: '1', letter: 'A', label: 'Estabilizar', score: 10 },
        { id: '2', letter: 'B', label: 'Crescer 2x', score: 20 },
        { id: '3', letter: 'C', label: 'Crescer 5x+', score: 30, tag: 'high-growth' },
      ] }),
    captureName(), captureWhatsapp(),
    block('end', {
      content: '💼 Diagnóstico de negocio pronto!',
      result_tiers: STD_TIERS_3(
        ['Negocio Inicial', 'Negocio em Crescimento', 'Pronto para Escala'],
        ['#f97316', '#3b82f6', '#10b981'],
        ['Vamos estruturar bases para crescer.', 'Está crescendo, vamos acelerar.', 'Hora de escalar con previsibilidade.'],
      ),
    }),
  );
}

function tplPerfilCliente() {
  return chain(
    block('text', { content: '🎯 Vamos descobrir tu perfil ideal de compra.' }),
    block('buttons', { label: 'Qual tu objetivo principal?', variable_name: 'objetivo',
      options: [
        { id: '1', letter: 'A', label: 'Aumentar vendas', score: 30, tag: 'vendas' },
        { id: '2', letter: 'B', label: 'Reduzir custos', score: 20, tag: 'custos' },
        { id: '3', letter: 'C', label: 'Estruturar processos', score: 15, tag: 'processos' },
      ] }),
    block('buttons', { label: 'Qual tu momento actual?', variable_name: 'momento',
      options: [
        { id: '1', letter: 'A', label: 'Estagnado', score: 25 },
        { id: '2', letter: 'B', label: 'Crescendo devagar', score: 15 },
        { id: '3', letter: 'C', label: 'Explodindo', score: 10 },
      ] }),
    block('buttons', { label: 'Quanto pretende investir?', variable_name: 'investimento',
      options: [
        { id: '1', letter: 'A', label: 'Até ₲ 500/mes', score: 5 },
        { id: '2', letter: 'B', label: '₲ 500 a ₲ 5k', score: 20 },
        { id: '3', letter: 'C', label: 'Acima de ₲ 5k', score: 35, tag: 'budget-alto' },
      ] }),
    block('buttons', { label: 'Qual tu urgência?', variable_name: 'urgencia',
      options: [
        { id: '1', letter: 'A', label: 'Já', score: 35, tag: 'urgente' },
        { id: '2', letter: 'B', label: '30 dias', score: 20 },
        { id: '3', letter: 'C', label: 'Sin pressa', score: 5 },
      ] }),
    captureName(), captureWhatsapp(),
    block('end', {
      content: '🎯 Tu perfil foi identificado!',
      result_tiers: STD_TIERS_3(
        ['Lead Frio', 'Lead Morno', 'Lead Quente'],
        ['#94a3b8', '#3b82f6', '#ef4444'],
        ['Nutrição via contenido.', 'Conversa em breve.', 'Especialista te chama hoje!'],
      ),
    }),
  );
}

function tplMaturidadeDigital() {
  return chain(
    block('text', { content: '💻 Vamos medir a maturidade digital do tu negocio.' }),
    block('buttons', { label: 'Possui site?', variable_name: 'site',
      options: [
        { id: '1', letter: 'A', label: 'No', score: 0 },
        { id: '2', letter: 'B', label: 'Básico', score: 10 },
        { id: '3', letter: 'C', label: 'Profissional', score: 20 },
      ] }),
    block('buttons', { label: 'Usa anúncios?', variable_name: 'ads',
      options: [
        { id: '1', letter: 'A', label: 'No', score: 0 },
        { id: '2', letter: 'B', label: 'Eventualmente', score: 10 },
        { id: '3', letter: 'C', label: 'Constantemente', score: 25 },
      ] }),
    block('buttons', { label: 'Usa CRM?', variable_name: 'crm',
      options: [
        { id: '1', letter: 'A', label: 'No', score: 0 },
        { id: '2', letter: 'B', label: 'Planilla', score: 10 },
        { id: '3', letter: 'C', label: 'Sim', score: 25 },
      ] }),
    block('buttons', { label: 'Usa automatizaciones?', variable_name: 'auto',
      options: [
        { id: '1', letter: 'A', label: 'No', score: 0 },
        { id: '2', letter: 'B', label: 'Pouco', score: 10 },
        { id: '3', letter: 'C', label: 'Sim, várias', score: 30, tag: 'auto-ok' },
      ] }),
    captureName(), captureWhatsapp(),
    block('end', {
      content: '💻 Resultado da tu maturidade digital.',
      result_tiers: STD_TIERS_3(
        ['Digital Básico', 'Digital em Evolución', 'Digital Avançado'],
        ['#f97316', '#3b82f6', '#10b981'],
        ['Comece por los fundamentos.', 'Estruturando bem.', 'Pronto para automatización total.'],
      ),
    }),
  );
}

// ───────────── NICHOS ─────────────
function tplImobiliario() {
  return chain(
    block('text', { content: '🏠 Vamos encontrar tu imóvel ideal!' }),
    block('buttons', { label: 'Qual tipo de imóvel procura?', variable_name: 'tipo',
      options: [
        { id: '1', letter: 'A', label: 'Apartamento', score: 15, tag: 'apto' },
        { id: '2', letter: 'B', label: 'Casa', score: 15, tag: 'casa' },
        { id: '3', letter: 'C', label: 'Comercial', score: 20, tag: 'comercial' },
      ] }),
    block('buttons', { label: 'Faixa de investimento?', variable_name: 'budget',
      options: [
        { id: '1', letter: 'A', label: 'Até ₲ 300k', score: 10 },
        { id: '2', letter: 'B', label: '₲ 300k a ₲ 1M', score: 25 },
        { id: '3', letter: 'C', label: 'Acima de ₲ 1M', score: 35, tag: 'alto-padrao' },
      ] }),
    block('buttons', { label: 'Comprar para?', variable_name: 'finalidade',
      options: [
        { id: '1', letter: 'A', label: 'Morar', score: 15, tag: 'morar' },
        { id: '2', letter: 'B', label: 'Investir', score: 20, tag: 'investidor' },
        { id: '3', letter: 'C', label: 'Especulação', score: 15 },
      ] }),
    block('buttons', { label: 'Cuando pretende comprar?', variable_name: 'cuando',
      options: [
        { id: '1', letter: 'A', label: 'Imediato', score: 35, tag: 'urgente' },
        { id: '2', letter: 'B', label: '6 meses', score: 20 },
        { id: '3', letter: 'C', label: 'Sin pressa', score: 5 },
      ] }),
    captureName(), captureWhatsapp(),
    block('end', {
      content: '🏠 Vamos encontrar tu imóvel!',
      result_tiers: STD_TIERS_3(
        ['Primero Imóvel', 'Investidor', 'Alto Potencial de Compra'],
        ['#94a3b8', '#3b82f6', '#10b981'],
        ['Vamos te guiar passo a passo.', 'Oportunidades selecionadas para usted.', 'Atendimento VIP imediato.'],
      ),
    }),
  );
}

function tplClinicas() {
  return chain(
    block('text', { content: '🏥 Vamos entender tu necessidade para te derivar.' }),
    block('buttons', { label: 'Qual servicio procura?', variable_name: 'servico',
      options: [
        { id: '1', letter: 'A', label: 'Estética', score: 15, tag: 'estetica' },
        { id: '2', letter: 'B', label: 'Saúde', score: 20, tag: 'saude' },
        { id: '3', letter: 'C', label: 'Evaluación', score: 10, tag: 'avaliacao' },
      ] }),
    block('buttons', { label: 'Há quanto tempo tem esa necessidade?', variable_name: 'tempo',
      options: [
        { id: '1', letter: 'A', label: 'Recente', score: 10 },
        { id: '2', letter: 'B', label: 'Meses', score: 20 },
        { id: '3', letter: 'C', label: 'Anos', score: 30, tag: 'cronico' },
      ] }),
    block('buttons', { label: 'Já fez tratamento antes?', variable_name: 'tratamento',
      options: [
        { id: '1', letter: 'A', label: 'No', score: 10 },
        { id: '2', letter: 'B', label: 'Sim, sin éxito', score: 25 },
        { id: '3', letter: 'C', label: 'Sim, parcial', score: 15 },
      ] }),
    block('buttons', { label: 'Atendimento preferido?', variable_name: 'modalidade',
      options: [
        { id: '1', letter: 'A', label: 'Presencial', score: 20 },
        { id: '2', letter: 'B', label: 'Online', score: 15 },
        { id: '3', letter: 'C', label: 'Tanto faz', score: 10 },
      ] }),
    captureName(), captureWhatsapp(),
    block('end', {
      content: '🏥 Recebemos tus dados. Nossa equipe vai te orientar.',
      result_tiers: STD_TIERS_3(
        ['Baixa Urgência', 'Media Urgência', 'Alta Urgência'],
        ['#94a3b8', '#3b82f6', '#ef4444'],
        ['Vamos te informar con calma.', 'Vamos agendar evaluación.', 'Atendimento prioritário hoje.'],
      ),
    }),
  );
}

function tplInfoprodutos() {
  return chain(
    block('text', { content: '🎓 Vamos descobrir o mejor camino de aprendizado pra usted.' }),
    block('buttons', { label: 'Tu nível actual?', variable_name: 'nivel',
      options: [
        { id: '1', letter: 'A', label: 'Iniciante', score: 10, tag: 'iniciante' },
        { id: '2', letter: 'B', label: 'Intermediário', score: 20, tag: 'intermediario' },
        { id: '3', letter: 'C', label: 'Avançado', score: 30, tag: 'avancado' },
      ] }),
    block('buttons', { label: 'Qual tu maior dificuldade?', variable_name: 'dificuldade',
      options: [
        { id: '1', letter: 'A', label: 'No sei por onde começar', score: 15 },
        { id: '2', letter: 'B', label: 'Falta consistência', score: 20 },
        { id: '3', letter: 'C', label: 'Quero técnicas avançadas', score: 25 },
      ] }),
    block('buttons', { label: 'Já comprou treinamento antes?', variable_name: 'treinamento',
      options: [
        { id: '1', letter: 'A', label: 'Nunca', score: 5 },
        { id: '2', letter: 'B', label: 'Sim, sin resultado', score: 25, tag: 'frustrado' },
        { id: '3', letter: 'C', label: 'Sim, e funcionou', score: 20 },
      ] }),
    block('buttons', { label: 'Tempo de dedicação semanal?', variable_name: 'tempo',
      options: [
        { id: '1', letter: 'A', label: 'Até 2h', score: 10 },
        { id: '2', letter: 'B', label: '3 a 5h', score: 20 },
        { id: '3', letter: 'C', label: '6h+', score: 30, tag: 'comprometido' },
      ] }),
    captureName(), captureEmail(),
    block('end', {
      content: '🎓 Tu ruta de aprendizado está pronta!',
      result_tiers: STD_TIERS_3(
        ['Iniciante', 'Intermediário', 'Avançado'],
        ['#f97316', '#3b82f6', '#10b981'],
        ['Comece por los fundamentos.', 'Hora de aprofundar.', 'Pronto para estratégias avançadas.'],
      ),
    }),
  );
}

// ───────────── CATÁLOGO ─────────────
export const QUIZ_TEMPLATES: QuizTemplate[] = [
  // Captação
  { id: 'captura-simples', name: 'Quiz de Captura Simples', description: 'Capture nome, WhatsApp e principal interesse em poucos segundos.',
    category: 'captacao', objective: 'Captar leads rápido', icon: '⚡', cover_gradient: 'from-emerald-500 to-teal-600',
    estimated_time: '30s', question_count: 1, flow_blocks: tplCapturaSimples(),
    badges: ['mais-usado', 'alta-conversao'] },
  { id: 'lista-espera', name: 'Quiz Lista de Espera', description: 'Captura leads para lançamento, evento ou produto futuro.',
    category: 'captacao', objective: 'Pré-lançamento', icon: '🚀', cover_gradient: 'from-violet-500 to-purple-600',
    estimated_time: '50s', question_count: 2, flow_blocks: tplListaEspera(),
    badges: ['recomendado'] },
  { id: 'evento-aula', name: 'Quiz Evento / Aula Ao Vivo', description: 'Capture inscritos e descubra o perfil antes do evento.',
    category: 'captacao', objective: 'Inscrição em evento', icon: '🎟️', cover_gradient: 'from-pink-500 to-rose-600',
    estimated_time: '60s', question_count: 3, flow_blocks: tplEvento(),
    badges: ['evento', 'recomendado'] },

  // Diagnóstico
  { id: 'diag-comercial', name: 'Diagnóstico Comercial', description: 'Avalia maturidade comercial e revela gargalos da operación de vendas.',
    category: 'diagnostico', objective: 'Diagnóstico de vendas', icon: '🎯', cover_gradient: 'from-blue-500 to-indigo-600',
    estimated_time: '60s', question_count: 4, flow_blocks: tplDiagnosticoComercial(),
    badges: ['diagnostico', 'mais-usado'] },
  { id: 'diag-agencia', name: 'Diagnóstico de Agência', description: 'Avalia operación, recorrência e dependência do fundador.',
    category: 'diagnostico', objective: 'Diagnóstico de agência', icon: '🏢', cover_gradient: 'from-cyan-500 to-blue-600',
    estimated_time: '60s', question_count: 4, flow_blocks: tplDiagnosticoAgencia(),
    badges: ['diagnostico'] },
  { id: 'diag-marketing', name: 'Diagnóstico de Marketing', description: 'Avalia maturidade de marketing e funil de aquisição.',
    category: 'diagnostico', objective: 'Diagnóstico de marketing', icon: '📊', cover_gradient: 'from-amber-500 to-orange-600',
    estimated_time: '60s', question_count: 4, flow_blocks: tplDiagnosticoMarketing(),
    badges: ['diagnostico'] },

  // Negocios
  { id: 'empresarial', name: 'Quiz Empresarial', description: 'Mede maturidade do negocio: faturamento, equipe, recorrência e meta.',
    category: 'negocios', objective: 'Calificación B2B', icon: '💼', cover_gradient: 'from-slate-600 to-slate-800',
    estimated_time: '60s', question_count: 4, flow_blocks: tplEmpresarial(),
    badges: ['mais-usado'] },
  { id: 'perfil-cliente', name: 'Quiz de Perfil de Cliente', description: 'Segmenta leads como frio, morno ou quente con base no perfil de compra.',
    category: 'negocios', objective: 'Calificación por perfil', icon: '🎯', cover_gradient: 'from-red-500 to-pink-600',
    estimated_time: '60s', question_count: 4, flow_blocks: tplPerfilCliente(),
    badges: ['alta-conversao'] },
  { id: 'maturidade-digital', name: 'Quiz de Maturidade Digital', description: 'Avalia nível digital — site, ads, CRM, automatizaciones e base.',
    category: 'negocios', objective: 'Maturidade digital', icon: '💻', cover_gradient: 'from-indigo-500 to-blue-700',
    estimated_time: '60s', question_count: 4, flow_blocks: tplMaturidadeDigital(),
    badges: ['recomendado'] },

  // Nichos
  { id: 'imobiliario', name: 'Quiz Imobiliário', description: 'Identifica imóvel ideal: tipo, faixa, finalidade e prazo.',
    category: 'nichos', objective: 'Imobiliário', icon: '🏠', cover_gradient: 'from-emerald-600 to-green-700',
    estimated_time: '60s', question_count: 4, flow_blocks: tplImobiliario(),
    badges: ['nicho'] },
  { id: 'clinicas', name: 'Quiz para Clínicas', description: 'Qualifica pacientes/interessados por urgência e tipo de servicio.',
    category: 'nichos', objective: 'Saúde e estética', icon: '🏥', cover_gradient: 'from-teal-500 to-emerald-600',
    estimated_time: '60s', question_count: 4, flow_blocks: tplClinicas(),
    badges: ['nicho'] },
  { id: 'infoprodutos', name: 'Quiz para Infoprodutos', description: 'Qualifica alunos por nível, dificuldade, historial e dedicação.',
    category: 'nichos', objective: 'Educação online', icon: '🎓', cover_gradient: 'from-purple-500 to-fuchsia-600',
    estimated_time: '60s', question_count: 4, flow_blocks: tplInfoprodutos(),
    badges: ['nicho', 'alta-conversao'] },
];

export const CATEGORY_LABELS: Record<QuizCategory, string> = {
  captacao: 'Captação',
  diagnostico: 'Diagnóstico',
  negocios: 'Negocios',
  nichos: 'Nichos',
  qualificacao: 'Calificación',
  recomendacao: 'Recomendación',
  educacional: 'Educacional',
};

export const BADGE_LABELS: Record<QuizBadge, string> = {
  'mais-usado': 'Mais usado',
  'recomendado': 'Recomendado',
  'alta-conversao': 'Alta conversión',
  'diagnostico': 'Diagnóstico',
  'evento': 'Evento',
  'nicho': 'Nicho específico',
  'ia': 'IA',
};
