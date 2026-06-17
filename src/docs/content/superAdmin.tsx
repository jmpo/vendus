import {
  Callout,
  Steps,
  Step,
  KeyValue,
  RelatedDocs,
  PageHero,
  Tag,
  FeatureGrid,
} from "../components";
import {
  Crown,
  Palette,
  Layers,
  Building2,
  Smartphone,
  KeyRound,
  Copy,
  ShieldCheck,
  Bell,
  Globe,
  LifeBuoy,
} from "lucide-react";
import type { DocPage } from "../types";

export const superAdminPages: DocPage[] = [
  {
    slug: "visao-general",
    title: "O que é o modo white label",
    description: "Usted dono da plataforma, várias empresas como clientes, tu marca em tudo.",
    track: "super-admin",
    section: "Visión general",
    order: 1,
    content: (
      <>
        <PageHero eyebrow="Super Admin" icon={Crown} title="Visión general do white label" description="Usted opera a plataforma sob tu marca. Cada cliente vê o Vendus como tu propio sistema." />

        <h2>O que muda</h2>
        <KeyValue
          rows={[
            ["Marca", "Logo, cores (HSL), nome da plataforma e domínio propio."],
            ["Isolamento", "Cada empresa é uma organización totalmente isolada (RLS + organization_id)."],
            ["Planos", "Usted cria os planos e cobra. O Vendus aplica os limites."],
            ["Suporte", "Usted é o ponto de contato. A Central de Ajuda mostra tu marca."],
          ]}
        />

        <RelatedDocs items={[
          { to: "/docs/super-admin/identidade", title: "Identidade visual", description: "Logo, cores, nome." },
          { to: "/docs/super-admin/planos", title: "Planos da plataforma" },
          { to: "/docs/super-admin/empresas", title: "Gerenciar empresas" },
        ]}/>
      </>
    ),
  },

  {
    slug: "identidade",
    title: "Identidade visual",
    description: "Logo, cores HSL, nome, favicon e textos do login.",
    track: "super-admin",
    section: "Marca",
    order: 2,
    content: (
      <>
        <PageHero eyebrow="Marca" icon={Palette} title="Identidade visual" />
        <h2>Onde configurar</h2>
        <p><strong>/super-admin → Identidade Visual</strong>. Mudanças são aplicadas en tiempo real para todos los usuarios via <code>usePlatformBranding</code>.</p>

        <h2>O que usted puede customizar</h2>
        <KeyValue
          rows={[
            ["Nome da plataforma", "Substitui 'Vendus' em todos los lugares."],
            ["Logo principal", "Header e tela de login. Recomendado SVG ou PNG transparente."],
            ["Favicon", "Aparece na aba do navegador e PWA."],
            ["Cor primária (HSL)", "Injetada em --primary. Use HSL ou hex; o sistema converte."],
            ["Layout do login", "Split-left, split-right, full ou centered."],
            ["Headline e subheadline do login", "Texto promocional na tela de entrada."],
            ["Imagem de fundo do login", "Hero personalizado."],
            ["Texto de rodapé", "Aparece no footer global."],
            ["Esconder branding do widget", "Remove 'Powered by' do chat externo (planos pagos)."],
          ]}
        />

        <Callout type="warn" title="Cores deben ser HSL">
          O Vendus usa HSL nas variables CSS para temas claro/escuro. Se usted colar hex, o sistema converte — mas
          o ideal é já enviar HSL para garantir contraste correto.
        </Callout>
      </>
    ),
  },

  {
    slug: "planos",
    title: "Planos da plataforma",
    description: "Crear planos com limites de leads, usuarios, mensajes IA e integraciones.",
    track: "super-admin",
    section: "Marca",
    order: 3,
    content: (
      <>
        <PageHero eyebrow="Marca" icon={Layers} title="Planos da plataforma" />
        <h2>Limites configuráveis</h2>
        <KeyValue
          rows={[
            ["Leads ativos", "Quantos leads simultâneos cabem na base."],
            ["Usuarios da equipe", "Vendedores + admins."],
            ["Mensajes de IA / mês", "Inclui tokens consumidos por agentes."],
            ["Conversas / mês", "Soma de todos los canais."],
            ["Integraciones ativas", "Hotmart, Cakto, Sankhya, etc."],
            ["Funis ativos", "Captura."],
            ["E-mails / mês", "Massa + transacional."],
          ]}
        />

        <h2>Como funciona o enforcement</h2>
        <p>
          Ao atingir o limite, o Vendus mostra um banner pedindo upgrade e bloqueia novas creaciones (no apaga
          existente). O flujo de upgrade é via Stripe/Cakto/Hotmart (usted elige).
        </p>
      </>
    ),
  },

  {
    slug: "empresas",
    title: "Empresas (organizaciones)",
    description: "Crear, suspender, mover e auditar empresas-cliente.",
    track: "super-admin",
    section: "Operación",
    order: 4,
    content: (
      <>
        <PageHero eyebrow="Operación" icon={Building2} title="Empresas (organizaciones)" />
        <h2>Crear uma empresa</h2>
        <Steps>
          <Step title="/super-admin → Empresas → Nova">Nome, e-mail do admin inicial, plano.</Step>
          <Step title="Convite automático">O admin recebe e-mail com link para definir contraseña.</Step>
          <Step title="Empresa criada">Tabelas isoladas, RLS aplicado, contadores zerados.</Step>
        </Steps>

        <h2>Acciones disponibles</h2>
        <ul>
          <li><strong>Suspender</strong>: bloqueia login mas mantém dados</li>
          <li><strong>Reativar</strong>: restaura acesso</li>
          <li><strong>Mover de plano</strong>: aplica novos limites na hora</li>
          <li><strong>Login como</strong> (impersonation): para suporte (gera log de auditoria)</li>
          <li><strong>Exportar dados</strong>: LGPD compliance</li>
        </ul>
      </>
    ),
  },

  {
    slug: "whatsapp-server",
    title: "Servidor Evolution global",
    description: "Crie instâncias e atrele a empresas. Empresa escaneia o QR.",
    track: "super-admin",
    section: "Operación",
    order: 5,
    content: (
      <>
        <PageHero eyebrow="Operación" icon={Smartphone} title="Servidor Evolution global" />
        <p>
          O servidor Evolution Go fica em <code>platform_settings</code> (global). Usted cria instâncias e atrela
          a empresas. Empresas <strong>no conseguem</strong> crear ou apagar instâncias (RLS bloqueia).
        </p>

        <h2>Flujo</h2>
        <Steps>
          <Step title="Configure o servidor uma vez">URL, API key, secret.</Step>
          <Step title="Crie uma instância para a empresa">Nome único (ex: cliente-acme-1).</Step>
          <Step title="Atrele à organización">Modal de selección.</Step>
          <Step title="A empresa escaneia o QR">Modal com polling automático de status.</Step>
        </Steps>

        <Callout type="warn" title="Empresa só vê tus próprias instâncias">
          RLS aplicada em <code>evolution_instances</code> filtra por organization_id. Empresa A nunca vê instância
          da empresa B.
        </Callout>
      </>
    ),
  },

  {
    slug: "credenciais",
    title: "Credenciais globais",
    description: "Resend, Firecrawl, OpenAI override e otras chaves compartilhadas.",
    track: "super-admin",
    section: "Operación",
    order: 6,
    content: (
      <>
        <PageHero eyebrow="Operación" icon={KeyRound} title="Credenciais globais" />
        <p>
          Algumas integraciones usam <strong>uma chave por plataforma</strong> (no por empresa). Configure em
          /super-admin → Integraciones Globais.
        </p>
        <KeyValue
          rows={[
            ["Resend API key", "E-mails transacionais e em massa."],
            ["Firecrawl API key", "Crawler para Brain e catálogo."],
            ["ElevenLabs API key", "Transcripción e voz."],
            ["OpenAI override", "Empresa puede usar chave propia via org_ai_credentials (no consome créditos Lovable)."],
          ]}
        />
        <Callout type="info" title="Roteamento de IA inteligente">
          Se uma empresa configurou <code>org_ai_credentials</code> + provider externo, a función <code>webchat-bot</code>
          chama a API direto. Sino, usa o Lovable AI Gateway (consumindo créditos da plataforma).
        </Callout>
      </>
    ),
  },

  {
    slug: "templates",
    title: "Templates globais",
    description: "E-mail, agentes, funis e cadências reutilizáveis por todas las empresas.",
    track: "super-admin",
    section: "Operación",
    order: 7,
    content: (
      <>
        <PageHero eyebrow="Operación" icon={Copy} title="Templates globais" />
        <p>
          Crie templates que aparecem como "modelos" para todas las empresas-cliente. Eles copiam o template e
          customizam — usted atualiza o original sin afetar as cópias.
        </p>
        <h2>Tipos suportados</h2>
        <ul>
          <li>Templates de e-mail (transacional e massa)</li>
          <li>Templates de agentes IA (persona + prompt + ferramentas)</li>
          <li>Templates de funis (estruturas prontas: captação SaaS, recuperación carrito, etc.)</li>
          <li>Templates de cadências (5 passos, 7 passos, recuperación fria, etc.)</li>
        </ul>
      </>
    ),
  },

  {
    slug: "auditoria",
    title: "Auditoria global",
    description: "platform_audit_logs: tudo que aconteceu, quem fez, cuando.",
    track: "super-admin",
    section: "Operación",
    order: 8,
    content: (
      <>
        <PageHero eyebrow="Operación" icon={ShieldCheck} title="Auditoria global" />
        <p>
          A tabela <code>platform_audit_logs</code> registra: creación/suspensão de empresas, mudanças de plano,
          impersonations (login como), reset de contraseña forçado, cambio de credenciais globais, exclusión de
          dados.
        </p>
        <Callout type="success" title="Compliance">
          Filtros por empresa, ator, acción e período. Exportável em CSV para auditoria externa (LGPD, SOC 2).
        </Callout>
      </>
    ),
  },

  {
    slug: "notificacoes",
    title: "Notificaciones administrativas",
    description: "Alertas multicanal para usted, dono da plataforma.",
    track: "super-admin",
    section: "Operación",
    order: 9,
    content: (
      <>
        <PageHero eyebrow="Operación" icon={Bell} title="Notificaciones administrativas" />
        <p>
          Tabela <code>admin_notifications</code> + Realtime + Resend. Usted recebe alertas cuando:
        </p>
        <ul>
          <li>Empresa próxima do limite do plano</li>
          <li>Fallo em integración crítica (Evolution caiu, Hotmart sin postback há 24h)</li>
          <li>Spike de uso de IA</li>
          <li>Nova empresa criada</li>
          <li>Pagamento recusado</li>
        </ul>
        <p>
          Um <strong>agente IA do admin</strong> también envia resumos diários e identifica predeterminados
          ("Empresa X dobrou volume esa semana").
        </p>
      </>
    ),
  },

  {
    slug: "dominio",
    title: "Domínio propio",
    description: "CNAME, SSL automático e e-mails do tu domínio.",
    track: "super-admin",
    section: "Operación",
    order: 10,
    content: (
      <>
        <PageHero eyebrow="Operación" icon={Globe} title="Domínio propio" />
        <h2>App</h2>
        <Steps>
          <Step title="Em Project Settings → Domains, clique em Connect Domain">Insira tu domínio.</Step>
          <Step title="Crie os registros DNS no tu registrador">A (185.158.133.1) + TXT (_lovable).</Step>
          <Step title="SSL é provisionado automaticamente">Em até 72h, normalmente em minutos.</Step>
        </Steps>

        <h2>E-mail (envio)</h2>
        <p>
          Em <strong>Lovable Cloud → Emails</strong>, configure o domínio de envio. Configure SPF, DKIM e DMARC
          conforme o painel mostra. Após verificación, e-mails saem como <code>vendas@suaempresa.com.br</code>.
        </p>

        <h2>Docs (esta documentación)</h2>
        <p>
          Aponte <code>docs.suaempresa.com.br</code> para o mismo projeto. Como o app é SPA, cualquier camino cai
          em <code>index.html</code> e o React Router resolve <code>/docs</code>.
        </p>
      </>
    ),
  },

  {
    slug: "suporte",
    title: "Suporte e Central de Ajuda",
    description: "Tickets, base de conocimiento e SLAs.",
    track: "super-admin",
    section: "Operación",
    order: 11,
    content: (
      <>
        <PageHero eyebrow="Operación" icon={LifeBuoy} title="Suporte e Central de Ajuda" />
        <h2>Central de Ajuda interna</h2>
        <p>
          Acessível dentro do app por <code>/ajuda</code>. Artigos categorizados, busca, badge de "novidade" no menu
          cuando usted publica algo.
        </p>
        <h2>Tickets de suporte</h2>
        <p>
          Vendedores e admins abrem tickets por la UI. Usted recebe na tu caixa de tickets, responde, marca como
          resolvido. SLA configurável (respuesta em até X horas).
        </p>
      </>
    ),
  },
];
