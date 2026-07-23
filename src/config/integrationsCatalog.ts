import type { LucideIcon } from 'lucide-react';
import {
  Brain,
  Sparkles,
  Cpu,
  CreditCard,
  Wallet,
  Mail,
  FileText,
  Inbox,
  CalendarDays,
  Facebook,
  Megaphone,
  TrendingUp,
  Webhook,
  Zap,
  Key,
} from 'lucide-react';

export type IntegrationStatus = 'active' | 'configurable' | 'coming_soon';

export interface IntegrationItem {
  id: string;
  name: string;
  description: string;
  icon: LucideIcon;
  /** Tailwind classes for the icon background tint */
  color: string;
  /** Component key — maps to a configurator in IntegrationConfigDrawer */
  configKey?:
    | 'whatsapp'
    | 'facebook'
    | 'email-config'
    | 'email-templates'
    | 'mass-email'
    | 'google-calendar'
    | 'api-keys'
    | 'openai'
    | 'anthropic'
    | 'gemini'
    | 'lovable-ai'
    | 'ai-routing'
    | 'hotmart'
    | 'meta-conversions'
    | 'webhooks-link';
  /** Marks the card visually but still opens config (e.g. native always-on services) */
  alwaysActive?: boolean;
  comingSoon?: boolean;
  /** Optional keywords to improve search matches */
  keywords?: string[];
  /** Optional brand logo (overrides Lucide icon when present) */
  logoSrc?: string;
}

export interface IntegrationCategory {
  id: string;
  label: string;
  icon: LucideIcon;
  description?: string;
  items: IntegrationItem[];
}

export const integrationsCatalog: IntegrationCategory[] = [
  {
    id: 'ai',
    label: 'Inteligencia Artificial',
    icon: Brain,
    description: 'Proveedores de modelos de IA para los agentes',
    items: [
      {
        id: 'lovable-ai',
        name: 'IA nativa',
        description: 'Gateway nativo (Gemini + GPT) — ya activo',
        icon: Sparkles,
        color: 'bg-violet-500/10 text-violet-500',
        configKey: 'lovable-ai',
        alwaysActive: true,
        keywords: ['gemini', 'gpt', 'nativo', 'predeterminado'],
      },
      {
        id: 'ai-routing',
        name: 'Ruteo de IA',
        description: 'Elegí qué IA atiende cada parte de la plataforma',
        icon: Brain,
        color: 'bg-violet-500/10 text-violet-500',
        configKey: 'ai-routing',
        keywords: ['ruteo', 'proveedor', 'capacidad', 'whatsapp', 'audio', 'imagen'],
      },
      {
        id: 'openai',
        name: 'OpenAI (ChatGPT)',
        description: 'Usá tu propia clave de OpenAI',
        icon: Cpu,
        color: 'bg-teal-500/10 text-teal-500',
        configKey: 'openai',
        keywords: ['gpt', 'chatgpt', 'gpt-4', 'gpt-5'],
      },
      {
        id: 'anthropic',
        name: 'Anthropic (Claude)',
        description: 'Conectá tu cuenta de Claude',
        icon: Brain,
        color: 'bg-orange-500/10 text-orange-500',
        configKey: 'anthropic',
        keywords: ['claude', 'sonnet', 'opus'],
      },
      {
        id: 'gemini',
        name: 'Google Gemini',
        description: 'Usá tu clave de Google AI',
        icon: Sparkles,
        color: 'bg-blue-500/10 text-blue-500',
        configKey: 'gemini',
        keywords: ['google', 'gemini'],
      },
    ],
  },
  {
    id: 'marketing',
    label: 'Marketing & Anuncios',
    icon: Megaphone,
    description: 'Captura de leads y medición de campañas',
    items: [
      {
        id: 'meta-conversions',
        name: 'Conversiones Meta Ads',
        description: 'Etapas y ventas cerradas se reportan a Meta para optimizar anuncios',
        icon: TrendingUp,
        color: 'bg-emerald-500/10 text-emerald-500',
        configKey: 'meta-conversions',
        alwaysActive: true,
        keywords: ['conversiones', 'capi', 'pixel', 'ctwa', 'ads', 'purchase', 'lead'],
      },
      {
        id: 'facebook',
        name: 'Facebook Lead Ads',
        description: 'Recibí leads de Facebook automáticamente',
        icon: Facebook,
        color: 'bg-blue-600/10 text-blue-600',
        configKey: 'facebook',
        keywords: ['meta', 'lead ads'],
      },
    ],
  },
  {
    id: 'payments',
    label: 'Pagos',
    icon: CreditCard,
    description: 'Cobranza y suscripciones',
    items: [
      {
        id: 'hotmart',
        name: 'Hotmart',
        description: 'Ventas, suscripciones y reembolsos',
        icon: CreditCard,
        color: 'bg-orange-500/10 text-orange-500',
        configKey: 'hotmart',
        logoSrc: '/integrations/logos/hotmart.png',
        keywords: ['hotmart', 'suscripción', 'webhook'],
      },
      {
        id: 'stripe',
        name: 'Stripe',
        description: 'Pagos internacionales y suscripciones',
        icon: CreditCard,
        color: 'bg-indigo-500/10 text-indigo-500',
        logoSrc: '/integrations/logos/stripe.svg',
        comingSoon: true,
      },
      {
        id: 'mercadopago',
        name: 'Mercado Pago',
        description: 'Pagos y suscripciones en la región',
        icon: Wallet,
        color: 'bg-yellow-500/10 text-yellow-500',
        logoSrc: '/integrations/logos/mercadopago.svg',
        comingSoon: true,
      },
    ],
  },
  {
    id: 'email',
    label: 'E-mail',
    icon: Mail,
    description: 'Envío transaccional, plantillas y campañas',
    items: [
      {
        id: 'email-config',
        name: 'Configuración de E-mail',
        description: 'Remitente, firma y logo',
        icon: Mail,
        color: 'bg-blue-500/10 text-blue-500',
        configKey: 'email-config',
        keywords: ['resend', 'remitente'],
      },
      {
        id: 'email-templates',
        name: 'Plantillas de E-mail',
        description: 'Modelos reutilizables de mensajes',
        icon: FileText,
        color: 'bg-purple-500/10 text-purple-500',
        configKey: 'email-templates',
      },
      {
        id: 'mass-email',
        name: 'E-mail masivo',
        description: 'Campañas para listas segmentadas',
        icon: Inbox,
        color: 'bg-pink-500/10 text-pink-500',
        configKey: 'mass-email',
        keywords: ['marketing', 'campaña'],
      },
    ],
  },
  {
    id: 'productivity',
    label: 'Agenda & Productividad',
    icon: CalendarDays,
    items: [
      {
        id: 'google-calendar',
        name: 'Google Calendar',
        description: 'Sincronizá la agenda de los vendedores',
        icon: CalendarDays,
        color: 'bg-blue-500/10 text-blue-500',
        configKey: 'google-calendar',
        keywords: ['google', 'agenda'],
      },
    ],
  },
  {
    id: 'tools',
    label: 'Herramientas & Webhooks',
    icon: Zap,
    description: 'Automatizaciones e integraciones a medida',
    items: [
      {
        id: 'api-keys',
        name: 'Claves de API',
        description: 'Resend, Firecrawl y otros servicios',
        icon: Key,
        color: 'bg-amber-500/10 text-amber-500',
        configKey: 'api-keys',
      },
      {
        id: 'webhooks',
        name: 'Webhooks personalizados',
        description: 'Configurá webhooks en Automatización → Webhooks',
        icon: Webhook,
        color: 'bg-violet-500/10 text-violet-500',
        configKey: 'webhooks-link',
      },
    ],
  },
];
