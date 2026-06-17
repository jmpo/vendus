import {
  Callout,
  Steps,
  Step,
  KeyValue,
  RelatedDocs,
  PageHero,
  Tag,
  FeatureGrid,
  Screenshot,
} from "../components";
import {
  Headphones,
  Inbox,
  MessageSquare,
  Phone,
  UserCheck,
  TrendingUp,
  ListTodo,
  Calendar,
  Sparkles,
  Send,
  Trophy,
  Keyboard,
  Smartphone,
  Bot,
} from "lucide-react";
import type { DocPage } from "../types";

export const vendedorPages: DocPage[] = [
  /* ============================================================ */
  {
    slug: "primeiros-passos",
    title: "Primeiros passos",
    description: "Login, status online/pausa, troca de contraseña e o que esperar no primero dia.",
    track: "vendedor",
    section: "Começando",
    order: 1,
    content: (
      <>
        <PageHero
          eyebrow="Ruta do Vendedor"
          icon={Headphones}
          title="Primeiros passos"
          description="Tudo o que usted precisa para entrar no Vendus por la primera vez e começar a atender no mismo dia."
        />
        <Screenshot src="/docs-screenshots/vendedor/login.jpg" alt="Tela de login do Vendus" caption="Tela de login — use o e-mail e contraseña do convite." />

        <h2>1. Login</h2>
        <p>
          Acesse a URL da tu empresa (ex.: <code>app.suaempresa.com.br</code>) e use o e-mail e a contraseña
          enviados no convite. Se chegou por um convite por e-mail, clique no link e defina tu contraseña — usted
          será redirecionado automaticamente para o app.
        </p>

        <Callout type="tip" title="Guardá como app no celular">
          Por el Chrome ou Safari mobile, use “Agregar à tela inicial”. O Vendus instala como PWA e funciona
          como um aplicativo nativo, com notificaciones push.
        </Callout>

        <h2>2. Defina tu status</h2>
        <p>
          No canto superior direito, elegí entre <Tag tone="primary">Online</Tag>{" "}
          <Tag>Em pausa</Tag> <Tag>Offline</Tag>. O motor de distribución automática
          (Auto Dispatch) usa ese status para decidir se usted recebe leads novos.
        </p>

        <KeyValue
          rows={[
            ["Online", "Recebe leads novos e conversas da fila."],
            ["Em pausa", "No recebe leads novos. Útil em reuniones e almoço."],
            ["Offline", "Sai da distribución. Use no fim do expediente."],
          ]}
        />

        <h2>3. Troque tu contraseña</h2>
        <Steps>
          <Step title="Abra tu Perfil">Clique no avatar (canto superior direito) → Perfil.</Step>
          <Step title="Vá em Segurança">Aba “Contraseña” → digite a contraseña actual e a nova.</Step>
          <Step title="Guardá">A sesión continua ativa; ningún logout necesario.</Step>
        </Steps>

        <h2>4. Confira tu agenda</h2>
        <p>
          Antes de tudo, abra <strong>Calendário</strong> e veja se há reuniones hoje. Eventos vindos do
          Google Calendar aparecem acá se usted conectou a integración (o admin puede ter feito).
        </p>

        <Callout type="info" title="O que esperar no primero dia">
          Em times com Auto Dispatch ativo, os primeiros leads chegam minutos após usted ficar
          <Tag tone="primary">Online</Tag>. Se o tu time usa solo fila manual, abra a Inbox e use
          <strong> Aceitar atendimento</strong> nas conversas em fila.
        </Callout>

        <RelatedDocs
          items={[
            { to: "/docs/vendedor/inbox", title: "Atendendo na Inbox", description: "Como funcionam fila, abas e setores." },
            { to: "/docs/vendedor/lead", title: "Entendendo o Lead", description: "Visión 360° do contato." },
            { to: "/docs/vendedor/mobile", title: "Vendus no celular (PWA)", description: "Instalar e usar offline." },
          ]}
        />
      </>
    ),
  },

  /* ============================================================ */
  {
    slug: "inbox",
    title: "Inbox: a central de conversas",
    description: "Como funciona a caixa de entrada omnichannel, abas, filtros por setor e aceitar conversas.",
    track: "vendedor",
    section: "Atendimento",
    order: 2,
    content: (
      <>
        <PageHero
          eyebrow="Atendimento"
          icon={Inbox}
          title="Inbox: a central de conversas"
          description="WhatsApp, webchat, Instagram, Messenger e Telegram em uma única tela, com filtros por setor e permisos."
        />
        <Screenshot src="/docs-screenshots/vendedor/inbox.jpg" alt="Inbox do vendedor com abas Em fila, Em atendimento e Resolvidas" caption="Inbox unificada: WhatsApp, Webchat, Instagram e mais em um só lugar." />

        <h2>As três abas</h2>
        <KeyValue
          rows={[
            ["Em fila", "Conversas aguardando humano OU sendo atendidas por IA. Cualquier um do setor puede assumir."],
            ["Em atendimento", "Conversas onde usted (ou alguém) é o atendente humano oficial."],
            ["Resolvidas", "Encerradas. Continuam consultáveis e pueden ser reabertas."],
          ]}
        />

        <Callout type="info" title="Regra do atendente único">
          Cada conversa tem solo <strong>um</strong> atendente: humano OU IA. Cuando usted aceita, a IA é
          desativada automaticamente. Cuando a IA assume, usted é liberado da conversa.
        </Callout>

        <h2>Visibilidade por setor</h2>
        <p>
          A Inbox <strong>no</strong> filtra por produto — quem decide o que usted vê é o <strong>setor</strong> ao
          qual usted pertence e as <strong>permisos granulares</strong> liberadas por el admin.
        </p>

        <KeyValue
          rows={[
            ["Atribuídas a mim", "Siempre visíveis, independente do setor."],
            ["Sin setor (no atribuídas)", "Visíveis se usted tiver permiso view_unassigned_sector_tickets."],
            ["Fila do meu setor", "Visíveis com permiso view_queue_conversations."],
            ["Otro vendedor do meu setor", "Visíveis com permiso view_other_users_conversations (supervisor)."],
            ["Setores diferentes do meu", "Visíveis com view_other_queues_conversations (admin/supervisor)."],
          ]}
        />

        <h2>Aceitar uma conversa</h2>
        <Steps>
          <Step title="Abra a aba “Em fila”">As conversas aguardando están lá, mais antigas no topo.</Step>
          <Step title="Seleccioná o setor (se houver mais de um)">
            O Vendus exige um setor para o aceite. Se usted só pertence a um, ele é selecionado automaticamente.
          </Step>
          <Step title="Clique em “Aceitar atendimento”">
            A conversa migra para “Em atendimento”, a IA é desativada e usted passa a ser o responsável.
          </Step>
        </Steps>

        <h2>Filtros e busca</h2>
        <ul>
          <li><strong>Por canal</strong>: WhatsApp, Webchat, Instagram, Messenger, Telegram.</li>
          <li><strong>Por produto</strong> (opcional): útil cuando usted atende vários produtos.</li>
          <li><strong>Por status do lead</strong>: novo, qualificado, perdido, etc.</li>
          <li><strong>Busca livre</strong>: nome, teléfono, e-mail ou contenido da última mensaje.</li>
        </ul>

        <Callout type="tip" title="Painel de Atendimento (admins)">
          Se usted é gerente, abra <strong>Atendimentos → Painel</strong> para a visión estilo call-center: conversas
          ativas en tiempo real, TMA, SLA, atendentes online e fila.
        </Callout>

        <RelatedDocs
          items={[
            { to: "/docs/vendedor/conversa", title: "Trabajando uma conversa", description: "Enviar mídia, transferir, encerrar." },
            { to: "/docs/conceitos/setor", title: "O que é um Setor", description: "Visibilidade e roteamento." },
            { to: "/docs/conceitos/atendente-unico", title: "Atendente único", description: "Regra humano-vs-IA." },
          ]}
        />
      </>
    ),
  },

  /* ============================================================ */
  {
    slug: "conversa",
    title: "Trabajando uma conversa",
    description: "Enviar texto, audio, mídia, item do catálogo, transferir e encerrar.",
    track: "vendedor",
    section: "Atendimento",
    order: 3,
    content: (
      <>
        <PageHero
          eyebrow="Atendimento"
          icon={MessageSquare}
          title="Trabajando uma conversa"
          description="Tudo que usted puede fazer dentro de uma conversa: mensajes, mídias, reacciones, transferencia e encerramento."
        />
        <Screenshot src="/docs-screenshots/vendedor/conversa.jpg" alt="Tela de conversa com lead" caption="Conversa em andamento: composer com audio, mídia, catálogo e copiloto." />

        <h2>Anatomia da tela</h2>
        <ul>
          <li><strong>Topo</strong>: dados do lead, canal, atendente actual, acciones rápidas (transferir, encerrar, chamar IA).</li>
          <li><strong>Centro</strong>: historial de mensajes unificado (todos los canais somados).</li>
          <li><strong>Direita</strong>: painel do lead — tags, score, BANT, tarefas, deals em aberto.</li>
          <li><strong>Inferior</strong>: caixa de mensaje com anexos, emoji, audio e catálogo.</li>
        </ul>

        <h2>Enviando mensajes</h2>
        <FeatureGrid
          items={[
            { icon: MessageSquare, title: "Texto", description: "Suporta formatação Markdown básica (negrito, itálico)." },
            { icon: Send, title: "Imagem / vídeo / PDF", description: "Arraste e solte ou clique no clipe." },
            { icon: Phone, title: "Audio", description: "Segure o microfone para gravar. Será transcrito por IA." },
            { icon: Sparkles, title: "Item do catálogo", description: "Busca semântica por los itens registrados do produto." },
          ]}
        />

        <Callout type="warn" title="Atención às limitaciones por canal">
          No WhatsApp, mensajes grandes são quebradas em até 2 partes (chunking) com 800ms de delay para parecer
          natural. Edições e exclusiones em provedores externos (Evolution/BotConversa) viram correções textuais visíveis.
        </Callout>

        <h2>Reacciones, edición e exclusión</h2>
        <ul>
          <li><strong>Reagir</strong>: passe o mouse sobre a mensaje → emoji.</li>
          <li><strong>Editar</strong>: clique nos três pontos da tu mensaje → Editar.</li>
          <li><strong>Eliminar</strong>: três pontos → Eliminar. No WhatsApp externo, vira “⚠️ Mensaje removida”.</li>
        </ul>

        <h2>Transferir a conversa</h2>
        <Steps>
          <Step title="Clique em “Transferir” no topo">Abre o modal de transferencia.</Step>
          <Step title="Elegí o destino">
            Otro vendedor, otro setor ou otra conexión WhatsApp (Evolution) — o historial é preservado.
          </Step>
          <Step title="Agregá um motivo (opcional)">
            Fica registrado no historial do lead para auditoria.
          </Step>
        </Steps>

        <h2>Chamar a IA de volta</h2>
        <p>
          O botón <Tag tone="primary">Chamar com IA</Tag> envia um prompt para a IA contextualizar e responder
          <strong> sin</strong> tirar usted do controle. Útil para sugerencias rápidas ou follow-ups noturnos.
        </p>

        <h2>Encerrar</h2>
        <p>
          Use <strong>Encerrar</strong> solo cuando o atendimento estiver realmente concluído. A conversa vai
          para “Resolvidas”, libera usted do contador <code>active_leads_count</code> e puede disparar pesquisa de
          satisfação automática (se o admin configurou).
        </p>

        <RelatedDocs
          items={[
            { to: "/docs/vendedor/whatsapp", title: "Particularidades do WhatsApp", description: "Debounce, chunking, instâncias." },
            { to: "/docs/vendedor/copiloto", title: "Copiloto de Vendas", description: "Sugerencias en tiempo real." },
            { to: "/docs/vendedor/lead", title: "Painel do Lead", description: "Tudo sobre o contato." },
          ]}
        />
      </>
    ),
  },

  /* ============================================================ */
  {
    slug: "whatsapp",
    title: "Particularidades do WhatsApp",
    description: "Debounce de 4s, chunking de mensajes, troca de instância e DDI 55.",
    track: "vendedor",
    section: "Atendimento",
    order: 4,
    content: (
      <>
        <PageHero eyebrow="Atendimento" icon={Phone} title="Particularidades do WhatsApp" description="O canal mais usado tem regras específicas. Entender economiza dor de cabeça." />
        <Screenshot src="/docs-screenshots/vendedor/whatsapp.jpg" alt="Conversa de WhatsApp dentro do Vendus" caption="WhatsApp nativo com debounce de 4s, chunking e edición sincronizada." />

        <h2>Debounce de 4 segundos</h2>
        <p>
          Cuando o cliente envia várias mensajes em sequência (“Oi”, “tudo bem?”, “quero saber sobre o produto”),
          o Vendus espera <strong>4 segundos</strong> sin novas mensajes antes da IA responder. Eso evita
          respuestas fragmentadas e parece mais natural.
        </p>

        <h2>Chunking de respuestas</h2>
        <p>
          Respuestas da IA com mais de <strong>500 caracteres</strong> são quebradas em no máximo 2 partes, com
          800ms entre elas. Visualmente parece tipeo humana.
        </p>

        <h2>DDI 55 obligatorio</h2>
        <Callout type="warn" title="Siempre Brasil">
          Toda saída de mensaje normaliza o teléfono para começar com <code>55</code> (Brasil). Números com DDI
          diferente <strong>no</strong> são enviados — o sistema bloqueia para evitar erros caros em API.
        </Callout>

        <h2>Provedores</h2>
        <KeyValue
          rows={[
            ["Evolution API", "Servidor global da plataforma. Usted só escaneia o QR. Suporta múltiplas instâncias, mídia, audio, grupos."],
            ["BotConversa", "API only (sin webhook). Edições e exclusiones viram corrección textual."],
            ["WhatsApp Cloud API (Meta)", "Conta oficial. Requer templates aprovados por la Meta fora da janela de 24h."],
          ]}
        />

        <h2>Trocar de conexión WhatsApp</h2>
        <p>
          No modal de transferencia, elegí “Trocar conexión Evolution”. O historial é <strong>preservado</strong> —
          a conversa no vira duplicata, ela é reaproveitada por la nova instância.
        </p>

        <Callout type="tip" title="Conta caiu?">
          Se aparecer o banner rojo “WhatsApp desconectado”, peça ao admin para reconectar por el QR em
          Configuraciones → WhatsApp. Mensajes enfileiradas são reenviadas automaticamente cuando volta.
        </Callout>

        <RelatedDocs
          items={[
            { to: "/docs/admin/integracoes", title: "Configurar integraciones", description: "Conectar Evolution e Meta." },
            { to: "/docs/conceitos/handoff", title: "Handoff IA → humano", description: "Como funciona a transición." },
          ]}
        />
      </>
    ),
  },

  /* ============================================================ */
  {
    slug: "lead",
    title: "Lead: visión 360°",
    description: "Resumo, BANT, Tarefas, Jornada, Origem, Carteira, Cadências e Formularios.",
    track: "vendedor",
    section: "CRM",
    order: 5,
    content: (
      <>
        <PageHero eyebrow="CRM" icon={UserCheck} title="Lead: visión 360°" description="Tudo o que usted precisa saber sobre o contato em uma tela só." />
        <Screenshot src="/docs-screenshots/vendedor/lead.jpg" alt="Modal 360° do lead com abas BANT, Jornada, Tarefas" caption="Lead 360°: dados, BANT, jornada, tarefas, cadências e carteira." />

        <h2>Como o lead nasce</h2>
        <p>
          Toda conversa nova cria automaticamente um lead, mismo sin produto vinculado. Cuando o atendimento começar
          a fazer sentido, basta vincular o produto e mover no funil.
        </p>

        <h2>Abas do Lead</h2>
        <KeyValue
          rows={[
            ["Resumo", "Tags, notas recentes, respuestas-chave, preview da conversa, score."],
            ["Conversas", "Historial unificado de todos los canais (WhatsApp + webchat + Instagram + ...)."],
            ["BANT", "Calificación Budget/Authority/Need/Timing em 17 perguntas. Veja a página dedicada."],
            ["Tarefas", "Pendências e follow-ups com prazo e responsável."],
            ["Jornada", "Timeline cronológica: todos los eventos (mudou etapa, recebeu cadência, virou cliente)."],
            ["Origem", "UTMs, referrer, landing page, primero toque. Saber de onde veio."],
            ["Carteira", "Historial de transferencias entre vendedores — auditoria completa."],
            ["Cadências", "Cadências ativas e finalizadas, com próxima acción e taxa de respuesta."],
            ["Formularios", "Respuestas a quizzes e formularios públicos."],
          ]}
        />

        <h2>Campos importantes</h2>
        <KeyValue
          rows={[
            ["Score (0-100)", "Alimentado por interações, BANT e respuestas em funis. Use para priorizar."],
            ["SDR", "Quem qualificou o lead. Puede ser diferente do Closer."],
            ["Closer", "Quem data o negocio. Asignación especializada para times com SDR/Closer."],
            ["Tags", "Clasificación livre. Tags pueden disparar automatizaciones (ver Admin → Tags)."],
            ["Status do funil", "Etapa actual no pipeline (Novo, Qualificado, Proposta, etc.)."],
            ["Custom fields", "Campos personalizados configurados por el admin."],
          ]}
        />

        <h2>Notas e auditoria</h2>
        <p>
          Toda nota fica registrada com data, autor e <strong>papel do autor</strong> (SDR, Closer, Admin) inferido
          dinamicamente. Use notas curtas e objetivas após interações relevantes — o time agradece.
        </p>

        <RelatedDocs
          items={[
            { to: "/docs/vendedor/deals", title: "Pipeline e Deals", description: "Crear e mover oportunidades." },
            { to: "/docs/vendedor/bant", title: "Calificación BANT", description: "Como qualificar com método." },
            { to: "/docs/conceitos/lead", title: "Conceito: Lead", description: "Definición profunda." },
          ]}
        />
      </>
    ),
  },

  /* ============================================================ */
  {
    slug: "deals",
    title: "Pipeline e Deals",
    description: "Crear oportunidade, valor automático por produto, Kanban e etapas.",
    track: "vendedor",
    section: "CRM",
    order: 6,
    content: (
      <>
        <PageHero eyebrow="CRM" icon={TrendingUp} title="Pipeline e Deals" description="Cada oportunidade comercial é um Deal. Valor preenchido automaticamente por el produto." />
        <Screenshot src="/docs-screenshots/vendedor/deals.jpg" alt="Kanban de oportunidades com colunas por etapa" caption="Kanban de Deals com valor automático puxado do produto." />

        <h2>O que é um Deal</h2>
        <p>
          Um <strong>Deal</strong> é uma oportunidade comercial vinculada a um lead. Carrega valor, etapa, probabilidade,
          produto e dono. Um lead puede ter vários deals (recompra, upsell, otro produto).
        </p>

        <h2>Crear um deal</h2>
        <Steps>
          <Step title="Abra o lead">Por el Pipeline, Inbox ou busca global.</Step>
          <Step title="Clique em “Novo deal”">Modal abre com produto e plano.</Step>
          <Step title="Elegí o produto e o plano">
            O <strong>valor é preenchido automaticamente</strong> por el pricing JSONB do produto. Usted puede editar
            se houver desconto.
          </Step>
          <Step title="Guardá">O deal vai para o etapa inicial do funil (Novo).</Step>
        </Steps>

        <h2>Kanban</h2>
        <p>
          Em <strong>Pipeline</strong>, arraste cards entre colunas: Novo → Qualificado → Proposta → Negociação →
          Ganho/Perdido. Toda movimentação fica registrada na Jornada do lead.
        </p>

        <Callout type="tip" title="Dica de hábito">
          Actualizá o etapa do deal siempre que mover o lead na conversa. Manter o pipeline limpo é o que faz os
          reportes de forecast funcionarem.
        </Callout>

        <h2>Filtros do Kanban</h2>
        <ul>
          <li>Por vendedor (eu, time todo, alguém específico)</li>
          <li>Por produto</li>
          <li>Por squad</li>
          <li>Por período (criado, atualizado, fechado)</li>
          <li>Por tag e por valor mínimo</li>
        </ul>

        <h2>Indicadores no card</h2>
        <KeyValue
          rows={[
            ["SLA", "Tempo desde a última interação. Rojo se passou do limite."],
            ["Próxima tarefa", "Mostra a tarefa mais próxima do prazo."],
            ["Último contato", "Cuando foi a última mensaje trocada."],
            ["Score", "Score do lead vinculado."],
          ]}
        />

        <RelatedDocs
          items={[
            { to: "/docs/vendedor/tarefas", title: "Tarefas", description: "Pendências e follow-ups." },
            { to: "/docs/admin/produtos", title: "Registrar produtos", description: "Como o pricing automático funciona." },
            { to: "/docs/vendedor/relatorios", title: "Metas e comisiones", description: "Veja tus números." },
          ]}
        />
      </>
    ),
  },

  /* ============================================================ */
  {
    slug: "tarefas",
    title: "Tarefas e follow-ups",
    description: "Crear manualmente, generar em lote por IA, alertas de retraso.",
    track: "vendedor",
    section: "CRM",
    order: 7,
    content: (
      <>
        <PageHero eyebrow="CRM" icon={ListTodo} title="Tarefas e follow-ups" />
        <Screenshot src="/docs-screenshots/vendedor/tarefas.jpg" alt="Lista de tarefas do vendedor" caption="Tarefas com vencimento, prioridade e generación em lote por IA." />
        <h2>Onde aparecem</h2>
        <p>Tarefas aparecem em <strong>3 lugares</strong>: aba “Tarefas” do lead, widget de alertas no Dashboard, e calendário pessoal.</p>

        <h2>Crear uma tarefa</h2>
        <Steps>
          <Step title="No lead, clique em “Nova tarefa”">Modal abre.</Step>
          <Step title="Defina título, prazo, prioridade e responsável">Puede ser usted ou otro membro do time.</Step>
          <Step title="Guardá">Notificación dispara para o responsável.</Step>
        </Steps>

        <h2>Generación em lote por IA</h2>
        <p>
          No Dashboard, o widget <Tag tone="primary">Generar tarefas com IA</Tag> analisa tus leads sin acción recente e
          sugere tarefas específicas (“Confirmar reunión com Carlos”, “Reenviar proposta para ACME”). Aceite uma a
          uma ou tudo de uma vez.
        </p>

        <h2>Alertas</h2>
        <ul>
          <li><strong>Vence hoje</strong> — badge amarelo no menu</li>
          <li><strong>Atrasada</strong> — badge rojo + notificación push</li>
          <li><strong>Sin responsável</strong> — só visível para admins</li>
        </ul>

        <Callout type="tip" title="Confira ao chegar">
          Antes de abrir a Inbox, dê uma olhada nas tarefas do dia. 5 minutos acá economizam horas después.
        </Callout>
      </>
    ),
  },

  /* ============================================================ */
  {
    slug: "agendamentos",
    title: "Agendamentos",
    description: "Ver agenda, crear evento e como a IA agenda sola.",
    track: "vendedor",
    section: "CRM",
    order: 8,
    content: (
      <>
        <PageHero eyebrow="CRM" icon={Calendar} title="Agendamentos" />
        <Screenshot src="/docs-screenshots/vendedor/agendamentos.jpg" alt="Calendário do vendedor com agendamentos" caption="Agenda integrada ao Google Calendar com sincronización bidirecional." />
        <h2>Tu agenda</h2>
        <p>
          Em <strong>Calendário</strong>, veja eventos do dia, semana ou mês. Se usted conectou o Google Calendar,
          eventos externos aparecem acá también — sincronización bidirecional.
        </p>
        <h2>Crear um evento</h2>
        <Steps>
          <Step title="Clique em um horario livre no calendário">Modal abre com o slot pré-preenchido.</Step>
          <Step title="Elegí lead, tipo de evento e duración">Tipos são configurados por el admin (Demo, Discovery, etc.).</Step>
          <Step title="Guardá">Confirmación automática vai por e-mail e WhatsApp para o lead.</Step>
        </Steps>

        <h2>A IA agenda por usted</h2>
        <Callout type="success" title="Modo autônomo">
          O agente de IA oferece <strong>proativamente 2 horarios reais</strong> ao lead, cria o evento na tu agenda
          e envia a confirmación — tudo sin usted levantar o dedo. Os slots oferecidos ficam salvos para evitar loops.
        </Callout>

        <h2>Disponibilidade</h2>
        <p>O sistema calcula slots disponibles considerando:</p>
        <ul>
          <li>Eventos do tu Google Calendar (se conectado)</li>
          <li>Eventos internos do Vendus</li>
          <li>Horario comercial da empresa</li>
          <li>Buffer entre reuniones e antecedência mínima</li>
          <li>Tu status actual (Online/Pausa)</li>
        </ul>

        <RelatedDocs
          items={[
            { to: "/docs/admin/agendamentos", title: "Configurar tipos de evento (admin)", description: "Duración, buffer, formulario." },
            { to: "/docs/conceitos/agente-ia", title: "Agente de IA", description: "Como funciona o vendedor virtual." },
          ]}
        />
      </>
    ),
  },

  /* ============================================================ */
  {
    slug: "copiloto",
    title: "Copiloto de Vendas",
    description: "IA assistente que sugere mensajes, trata objeciones e transcreve áudios.",
    track: "vendedor",
    section: "IA",
    order: 9,
    content: (
      <>
        <PageHero eyebrow="IA" icon={Bot} title="Copiloto de Vendas" description="Tu assistente en tiempo real durante o atendimento humano." />
        <Screenshot src="/docs-screenshots/vendedor/copiloto.jpg" alt="Copiloto de vendas sugerindo mensaje ao vendedor" caption="Copiloto: sugerencia de mensaje, objeciones e transcripción de audio." />
        <h2>O que ele faz</h2>
        <FeatureGrid
          items={[
            { icon: MessageSquare, title: "Sugere próxima mensaje", description: "Com base no historial e no Brain do produto." },
            { icon: Sparkles, title: "Trata objeciones", description: "Consulta o catálogo de objeciones e devolve respuesta + material de prova." },
            { icon: Phone, title: "Transcreve áudios", description: "ElevenLabs Scribe v2 em PT-BR com alta precisão." },
            { icon: UserCheck, title: "Analisa imagens", description: "Cliente mandou print? O Copiloto entende e responde." },
          ]}
        />

        <h2>Formato da respuesta</h2>
        <Callout type="info" title="3 partes, siempre">
          <strong>Intención</strong> (o que o cliente quer) · <strong>Mensaje</strong> sugerida (sin markdown) ·
          <strong>Pergunta</strong> de follow-up. Usted copia, ajusta e envia.
        </Callout>

        <h2>Estratégia híbrida</h2>
        <p>
          O Copiloto mistura fatos <strong>estritos</strong> do Brain do produto com estratégia de vendas
          <strong> ampla</strong>. Resultado: respuestas verdadeiras (no alucinadas) e persuasivas.
        </p>

        <h2>Cuando usar</h2>
        <ul>
          <li>Cliente fez pergunta técnica que usted no sabe → consulta no Brain</li>
          <li>Cliente trouxe objeción (“está caro”) → tratamento estruturado</li>
          <li>Cliente mandou audio longo → pede para transcrever</li>
          <li>Antes de fechar → revisión da última proposta enviada</li>
        </ul>
      </>
    ),
  },

  /* ============================================================ */
  {
    slug: "cadencias",
    title: "Cadências inteligentes",
    description: "Sequências automáticas de toques para nutrir e recuperar leads.",
    track: "vendedor",
    section: "Automatización",
    order: 10,
    content: (
      <>
        <PageHero eyebrow="Automatización" icon={Send} title="Cadências inteligentes" />
        <Screenshot src="/docs-screenshots/vendedor/cadencias.jpg" alt="Enrollar lead em cadência inteligente" caption="Cadências inteligentes: outreach IA escalonado em horario comercial." />
        <h2>O que são</h2>
        <p>
          Cadências são sequências automáticas de toques (mensajes, áudios, materiais) executadas com tom contextual
          por la IA. Servem para nutrir leads frios, recuperar carrito, fazer follow-up pós-reunión.
        </p>

        <h2>Enrollar um lead</h2>
        <Steps>
          <Step title="Abra o lead → aba “Cadências”">Lista as disponibles.</Step>
          <Step title="Clique em “Iniciar cadência”">Elegí qual.</Step>
          <Step title="Pronto">A próxima ejecución acontece no horario comercial configurado.</Step>
        </Steps>

        <h2>Auto-stop por respuesta</h2>
        <Callout type="success" title="No envia mensaje em cima de mensaje">
          Cuando o lead responde, a cadência <strong>para automaticamente</strong>. Eso evita parecer robô e mantém
          o engajamento humano.
        </Callout>

        <h2>Métricas que importam</h2>
        <ul>
          <li>Taxa de respuesta por step</li>
          <li>Leads ativos vs concluídos vs parados por respuesta</li>
          <li>Tempo médio até a primera respuesta</li>
        </ul>
      </>
    ),
  },

  /* ============================================================ */
  {
    slug: "bant",
    title: "Calificación BANT",
    description: "Framework Budget/Authority/Need/Timing em 17 perguntas, score 0-100.",
    track: "vendedor",
    section: "CRM",
    order: 11,
    content: (
      <>
        <PageHero eyebrow="CRM" icon={UserCheck} title="Calificación BANT" />
        <Screenshot src="/docs-screenshots/vendedor/bant.jpg" alt="Calificación BANT do lead com 17 perguntas" caption="Calificación BANT: 17 perguntas que geram score 0–100." />
        <h2>O framework</h2>
        <KeyValue
          rows={[
            ["B — Budget", "Tem orçamento? Quanto? Quem aprova?"],
            ["A — Authority", "Decide solo? Há comitê? Quem mais participa?"],
            ["N — Need", "Qual a dor? Quantificada em $ ou tempo?"],
            ["T — Timing", "Cuando? Por que ahora? Há prazo externo?"],
          ]}
        />

        <h2>Como funciona no Vendus</h2>
        <p>
          A aba BANT do lead tem 17 perguntas pré-definidas (4-5 por categoria). Usted responde durante o atendimento.
          O sistema calcula um <strong>score de 0 a 100</strong> visível no card do Kanban e no resumo do lead.
        </p>

        <Callout type="tip" title="Boa prática">
          No responda BANT no primero contato — espere até a 2ª ou 3ª interação. Forçar o framework cedo demais
          quebra o rapport.
        </Callout>
      </>
    ),
  },

  /* ============================================================ */
  {
    slug: "relatorios",
    title: "Metas, comisiones e leaderboard",
    description: "Acompanhe tus números, batidas de meta e ranking do time.",
    track: "vendedor",
    section: "Performance",
    order: 12,
    content: (
      <>
        <PageHero eyebrow="Performance" icon={Trophy} title="Metas, comisiones e leaderboard" />
        <Screenshot src="/docs-screenshots/vendedor/relatorios.jpg" alt="Painel de metas, comisiones e leaderboard" caption="Metas, comisiones e leaderboard en tiempo real." />
        <h2>Onde olhar</h2>
        <ul>
          <li><strong>Dashboard</strong>: número do mês, conversión, sparkline dos últimos 30 dias</li>
          <li><strong>Metas</strong>: barra de progresso individual e do squad</li>
          <li><strong>Leaderboard</strong>: ranking dos vendedores por receita / leads / conversión</li>
          <li><strong>Comisiones</strong>: cálculo automático por deal fechado</li>
        </ul>

        <h2>Insights de IA</h2>
        <p>
          O widget de Insights destaca: tendências (positivas e negativas), leads em risco de esfriar, próximas acciones
          sugeridas. Use 5 minutos por dia para revisar.
        </p>
      </>
    ),
  },

  /* ============================================================ */
  {
    slug: "atajos",
    title: "Atajos e dicas",
    description: "Atajos de teclado e hábitos que economizam tempo.",
    track: "vendedor",
    section: "Performance",
    order: 13,
    content: (
      <>
        <PageHero eyebrow="Performance" icon={Keyboard} title="Atajos e dicas" />
        <Screenshot src="/docs-screenshots/vendedor/atajos.jpg" alt="Lista de atajos de teclado" caption="Atajos para acelerar o atendimento no Vendus." />
        <h2>Atajos globais</h2>
        <KeyValue
          rows={[
            [<><kbd>⌘</kbd>+<kbd>K</kbd></>, "Busca global"],
            [<><kbd>?</kbd></>, "Lista de atajos"],
            [<><kbd>g</kbd> <kbd>i</kbd></>, "Ir para Inbox"],
            [<><kbd>g</kbd> <kbd>p</kbd></>, "Ir para Pipeline"],
            [<><kbd>g</kbd> <kbd>c</kbd></>, "Ir para Calendário"],
            [<><kbd>n</kbd></>, "Novo lead"],
            [<><kbd>e</kbd></>, "Encerrar conversa selecionada"],
            [<><kbd>t</kbd></>, "Transferir conversa"],
          ]}
        />

        <h2>Hábitos que escalam</h2>
        <ul>
          <li>Status correto: <Tag tone="primary">Online</Tag> só cuando puder atender de verdade</li>
          <li>Etapa do deal atualizado em até 24h após mudança real</li>
          <li>Nota curta após cada interação ({"<"}3 líneas)</li>
          <li>BANT preenchido até a 3ª conversa</li>
          <li>Cadência ativa para todo lead que esfriou {">"}7 dias</li>
        </ul>
      </>
    ),
  },

  /* ============================================================ */
  {
    slug: "mobile",
    title: "Vendus no celular (PWA)",
    description: "Instalar como app, usar offline e receber notificaciones push.",
    track: "vendedor",
    section: "Performance",
    order: 14,
    content: (
      <>
        <PageHero eyebrow="Performance" icon={Smartphone} title="Vendus no celular (PWA)" />
        <Screenshot src="/docs-screenshots/vendedor/mobile.jpg" alt="Vendus instalado como PWA no celular" caption="PWA nativo no celular com notificaciones push e modo offline." />
        <h2>Instalar</h2>
        <KeyValue
          rows={[
            ["Android (Chrome)", "Menu (⋮) → Agregar à tela inicial → Instalar"],
            ["iOS (Safari)", "Compartir → Agregar à Tela Inicial"],
          ]}
        />

        <h2>O que tem na versión mobile</h2>
        <ul>
          <li>Inbox completa e otimizada para telas pequenas</li>
          <li>Mini pipeline arrastável</li>
          <li>Splash, gestos de pull-to-refresh, haptics</li>
          <li>Push notifications de novas conversas e tarefas</li>
          <li>Modo offline para visualizar o que foi carregado (envios ficam em fila)</li>
        </ul>

        <Callout type="tip" title="Bateria longa">
          Use o tema escuro nas configuraciones do dispositivo. O Vendus segue automaticamente.
        </Callout>
      </>
    ),
  },
];
