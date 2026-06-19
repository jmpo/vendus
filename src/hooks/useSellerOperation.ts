import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export interface PriorityItem {
  id: string;
  kind: 'conversation' | 'lead' | 'meeting';
  name: string;
  company?: string | null;
  status?: string | null;
  reason: string;
  ageMinutes?: number;
  actionLabel: 'Responder' | 'Ligar' | 'Abrir';
  actionTab: 'inbox' | 'leads' | 'bookings';
  payloadId: string;
}

export interface NextEvent {
  id: string;
  title: string;
  startTime: string;
  withName?: string | null;
}

export interface AIInsight {
  id: string;
  icon: 'flame' | 'alert' | 'calendar' | 'message' | 'trend';
  text: string;
}

export interface TimelineItem {
  id: string;
  time: string; // HH:mm
  startIso: string;
  kind: 'meeting' | 'task' | 'conversation' | 'lead';
  title: string;
  description?: string;
  countdown: string;
  tone: 'emerald' | 'sky' | 'amber' | 'destructive' | 'violet';
}

export interface SellerOperation {
  unansweredCount: number;
  activeLeadsCount: number;
  todayMeetings: number;
  todayPendingTasks: number;
  priorities: PriorityItem[];
  nextEvent: NextEvent | null;
  insights: AIInsight[];
  timeline: TimelineItem[];
  myDay: { tasks: number; meetings: number; activeLeads: number };
  footer: {
    conversationsToday: number;
    activeCadences: number;
    scheduledMessages: number;
    followupsToday: number;
  };
}

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
};
const endOfToday = () => {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d.toISOString();
};

const minutesSince = (iso?: string | null) => {
  if (!iso) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000));
};

const humanizeAge = (mins: number) => {
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
};

const formatHHmm = (iso: string) =>
  new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

const formatCountdown = (iso: string) => {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) {
    const past = Math.floor(-diff / 60_000);
    if (past < 60) return `há ${past} min`;
    const h = Math.floor(past / 60);
    return `há ${h}h`;
  }
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `Em ${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `Em ${h}h${m.toString().padStart(2, '0')}min` : `Em ${h}h`;
};

const safeCount = (res: { count?: number | null } | undefined | null) =>
  res && typeof res.count === 'number' ? res.count : 0;

export function useSellerOperation() {
  const { user, profile } = useAuth();
  const orgId = profile?.organization_id;
  const userId = user?.id;

  return useQuery({
    queryKey: ['seller-operation', orgId, userId],
    enabled: !!orgId && !!userId,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<SellerOperation> => {
      const today = startOfToday();
      const eod = endOfToday();
      const now = new Date().toISOString();
      const staleMins = 15;
      const staleIso = new Date(Date.now() - staleMins * 60_000).toISOString();

      const [
        unansweredRes,
        activeLeadsRes,
        prioritiesConvsRes,
        prioritiesLeadsRes,
        nextEventsRes,
        todayMeetingsRes,
        todayTasksRes,
        overdueTasksRes,
        upcomingTasksRes,
        conversationsTodayRes,
        activeCadencesRes,
        scheduledMessagesRes,
        followupsTodayRes,
      ] = await Promise.all([
        supabase
          .from('webchat_conversations')
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', orgId)
          .eq('assigned_user_id', userId)
          .in('status', ['waiting_human', 'human_active'])
          .lt('last_message_at', staleIso),
        supabase
          .from('leads')
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', orgId)
          .eq('assigned_to', userId),
        supabase
          .from('webchat_conversations')
          .select('id, lead_id, last_message_at, visitor_name, leads:leads(name, company)')
          .eq('organization_id', orgId)
          .eq('assigned_user_id', userId)
          .in('status', ['waiting_human', 'human_active'])
          .lt('last_message_at', staleIso)
          .order('last_message_at', { ascending: true })
          .limit(5),
        supabase
          .from('leads')
          .select('id, name, company, temperature, updated_at')
          .eq('organization_id', orgId)
          .eq('assigned_to', userId)
          .eq('temperature', 'hot')
          .order('updated_at', { ascending: true })
          .limit(5),
        supabase
          .from('calendar_events')
          .select('id, title, start_time, lead:leads(name)')
          .eq('organization_id', orgId)
          .eq('user_id', userId)
          .gte('start_time', today)
          .lte('start_time', eod)
          .order('start_time', { ascending: true })
          .limit(8),
        supabase
          .from('calendar_events')
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', orgId)
          .eq('user_id', userId)
          .gte('start_time', today)
          .lte('start_time', eod),
        supabase
          .from('tasks')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userId)
          .neq('status', 'completed')
          .gte('due_date', today)
          .lte('due_date', eod),
        supabase
          .from('tasks')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userId)
          .neq('status', 'completed')
          .lt('due_date', now),
        supabase
          .from('tasks')
          .select('id, title, due_date, type, leads:leads(name, company)')
          .eq('user_id', userId)
          .neq('status', 'completed')
          .gte('due_date', today)
          .lte('due_date', eod)
          .order('due_date', { ascending: true })
          .limit(8),
        supabase
          .from('webchat_conversations')
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', orgId)
          .eq('assigned_user_id', userId)
          .gte('created_at', today)
          .lte('created_at', eod),
        supabase
          .from('cadence_enrollments')
          .select('id, leads!inner(assigned_to)', { count: 'exact', head: true })
          .eq('organization_id', orgId)
          .eq('status', 'active')
          .eq('leads.assigned_to', userId),
        supabase
          .from('cadence_step_runs')
          .select('id, enrollment:cadence_enrollments!inner(lead:leads!inner(assigned_to))', {
            count: 'exact',
            head: true,
          })
          .eq('organization_id', orgId)
          .eq('status', 'pending')
          .gte('scheduled_at', now)
          .eq('enrollment.lead.assigned_to', userId),
        supabase
          .from('tasks')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userId)
          .eq('status', 'completed')
          .gte('completed_at', today)
          .lte('completed_at', eod),
      ]);

      // ===== Priorities =====
      const priorities: PriorityItem[] = [];
      for (const c of prioritiesConvsRes.data ?? []) {
        const leadRel: any = (c as any).leads;
        const name = leadRel?.name || (c as any).visitor_name || 'Contato';
        const ageMin = minutesSince((c as any).last_message_at);
        priorities.push({
          id: `conv-${c.id}`,
          kind: 'conversation',
          name,
          company: leadRel?.company ?? null,
          status: leadRel?.status ?? null,
          reason: `Sem resposta há ${humanizeAge(ageMin)}`,
          ageMinutes: ageMin,
          actionLabel: 'Responder',
          actionTab: 'inbox',
          payloadId: c.id,
        });
      }

      const events = (nextEventsRes as any).data ?? [];
      const futureEvent = events.find(
        (e: any) => new Date(e.start_time).getTime() >= Date.now()
      );
      if (futureEvent) {
        const mins = Math.floor(
          (new Date(futureEvent.start_time).getTime() - Date.now()) / 60_000
        );
        if (mins <= 120 && mins >= -30) {
          const time = formatHHmm(futureEvent.start_time);
          priorities.unshift({
            id: `evt-${futureEvent.id}`,
            kind: 'meeting',
            name: futureEvent.lead?.name || futureEvent.title || 'Reunião',
            reason: `Reunião às ${time}`,
            actionLabel: 'Abrir',
            actionTab: 'bookings',
            payloadId: futureEvent.id,
          });
        }
      }

      for (const l of prioritiesLeadsRes.data ?? []) {
        const ageMin = minutesSince(l.updated_at as any);
        priorities.push({
          id: `lead-${l.id}`,
          kind: 'lead',
          name: l.name || 'Lead',
          company: (l as any).company ?? null,
          status: (l as any).status ?? null,
          reason: l.company
            ? `${l.company} • Lead quente`
            : 'Lead quente sem ação recente',
          ageMinutes: ageMin,
          actionLabel: 'Ligar',
          actionTab: 'leads',
          payloadId: l.id,
        });
      }

      const top5 = priorities.slice(0, 5);

      const nextEvent: NextEvent | null = futureEvent
        ? {
            id: futureEvent.id,
            title: futureEvent.title || 'Reunião',
            startTime: futureEvent.start_time,
            withName: futureEvent.lead?.name ?? null,
          }
        : null;

      // ===== Timeline (Meu Dia) =====
      const timeline: TimelineItem[] = [];
      for (const e of events) {
        timeline.push({
          id: `t-evt-${e.id}`,
          time: formatHHmm(e.start_time),
          startIso: e.start_time,
          kind: 'meeting',
          title: e.lead?.name ? `Reunião com ${e.lead.name}` : e.title || 'Reunião',
          description: e.title || undefined,
          countdown: formatCountdown(e.start_time),
          tone: 'emerald',
        });
      }
      for (const t of upcomingTasksRes.data ?? []) {
        if (!t.due_date) continue;
        const leadRel: any = (t as any).leads;
        const tone: TimelineItem['tone'] =
          t.type === 'cadence' ? 'sky' : t.type === 'followup' ? 'amber' : 'violet';
        timeline.push({
          id: `t-task-${t.id}`,
          time: formatHHmm(t.due_date),
          startIso: t.due_date,
          kind: 'task',
          title: t.title,
          description: leadRel?.name
            ? leadRel.company
              ? `${leadRel.name} • ${leadRel.company}`
              : leadRel.name
            : undefined,
          countdown: formatCountdown(t.due_date),
          tone,
        });
      }
      timeline.sort(
        (a, b) => new Date(a.startIso).getTime() - new Date(b.startIso).getTime()
      );

      // ===== Insights =====
      const insights: AIInsight[] = [];
      const hotCount = prioritiesLeadsRes.data?.length ?? 0;
      const overdue = safeCount(overdueTasksRes);
      const unanswered = safeCount(unansweredRes);
      if (hotCount > 0) {
        insights.push({
          id: 'hot',
          icon: 'flame',
          text: `${hotCount} lead${hotCount > 1 ? 's' : ''} quente${hotCount > 1 ? 's' : ''} sem retorno`,
        });
      }
      if (overdue > 0) {
        insights.push({
          id: 'overdue',
          icon: 'alert',
          text: `Você possui ${overdue} tarefa${overdue > 1 ? 's' : ''} vencida${overdue > 1 ? 's' : ''}`,
        });
      }
      if (nextEvent) {
        const mins = Math.floor(
          (new Date(nextEvent.startTime).getTime() - Date.now()) / 60_000
        );
        const meetingsSoon = events.filter((e: any) => {
          const m = Math.floor((new Date(e.start_time).getTime() - Date.now()) / 60_000);
          return m >= 0 && m <= 30;
        }).length;
        if (meetingsSoon > 0) {
          insights.push({
            id: 'meetings-soon',
            icon: 'calendar',
            text: `${meetingsSoon} reunião${meetingsSoon > 1 ? 'ões' : ''} começam em 30 minutos`,
          });
        } else if (mins >= 0 && mins <= 120) {
          insights.push({
            id: 'meeting-soon',
            icon: 'calendar',
            text:
              mins < 60
                ? `1 reunião em ${mins} min`
                : `1 reunião em ${Math.round(mins / 60)}h`,
          });
        }
      }
      if (unanswered > 0) {
        insights.push({
          id: 'unanswered',
          icon: 'message',
          text: `${unanswered} conversa${unanswered > 1 ? 's' : ''} aguardam resposta`,
        });
      }

      return {
        unansweredCount: unanswered,
        activeLeadsCount: safeCount(activeLeadsRes),
        todayMeetings: safeCount(todayMeetingsRes),
        todayPendingTasks: safeCount(todayTasksRes),
        priorities: top5,
        nextEvent,
        insights: insights.slice(0, 5),
        timeline: timeline.slice(0, 6),
        myDay: {
          tasks: safeCount(todayTasksRes),
          meetings: safeCount(todayMeetingsRes),
          activeLeads: safeCount(activeLeadsRes),
        },
        footer: {
          conversationsToday: safeCount(conversationsTodayRes),
          activeCadences: safeCount(activeCadencesRes),
          scheduledMessages: safeCount(scheduledMessagesRes),
          followupsToday: safeCount(followupsTodayRes),
        },
      };
    },
  });
}
