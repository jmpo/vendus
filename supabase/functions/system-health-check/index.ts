// system-health-check
// Chequeo de salud del sistema "sobre la marcha". Corre on-demand o por cron:
//   - crons que NO terminaron 'succeeded' en las últimas 2h
//   - ai_outreach_queue con 'failed'
//   - respuestas HTTP 5xx recientes (pg_net) — fallos de funciones internas
//   - conversaciones WhatsApp sin lead (deberían vincularse solas)
//   - key de OpenAI válida (ping liviano)
// Por cada problema NUEVO inserta un system_alert (a los admins) — con dedup de 60 min —
// así el equipo se entera al toque. Devuelve un reporte JSON para verlo on-demand.
import postgres from 'https://deno.land/x/postgresjs@v3.4.4/mod.js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface Issue { severity: 'critical' | 'warning'; key: string; title: string; detail: string; }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, { prepare: false });
  const issues: Issue[] = [];

  try {
    // 1) Crons con fallas recientes.
    // cron.job_run_details crece sin parar; las subconsultas correlacionadas por job hacían
    // timeout y tumbaban todo. Ahora leemos UNA sola pasada acotada a las corridas recientes.
    try {
      const lastRuns = await sql`
        select distinct on (d.jobid) d.jobid, d.status, d.start_time, j.jobname
        from cron.job_run_details d
        join cron.job j on j.jobid = d.jobid and j.active
        where d.start_time > now() - interval '3 hours'
        order by d.jobid, d.start_time desc`;
      for (const c of lastRuns as any[]) {
        if (c.status && c.status !== 'succeeded') {
          issues.push({ severity: 'critical', key: `cron:${c.jobname}`, title: `⚠️ Cron con fallo: ${c.jobname}`, detail: `Último estado: ${c.status} (${c.start_time})` });
        }
      }
    } catch (e) {
      console.warn('[health] chequeo de crons omitido:', String(e).slice(0, 120));
    }

    // 2) ai_outreach_queue fallidos
    const failedOutreach = (await sql`select count(*)::int as n from ai_outreach_queue where status='failed'`)[0] as any;
    if (Number(failedOutreach.n) > 0) {
      const sample = (await sql`select left(error_message,200) as e from ai_outreach_queue where status='failed' order by created_at desc limit 1`)[0] as any;
      issues.push({ severity: 'warning', key: 'outreach:failed', title: `⚠️ Follow-ups fallidos: ${failedOutreach.n}`, detail: sample?.e || 'sin detalle' });
    }

    // 3) HTTP 5xx recientes (funciones internas fallando).
    // OJO: net._http_response crece MUCHO (cada llamada de cron deja una fila) y un scan por
    // `created` hacía timeout → tumbaba TODO el health-check con 500. Acotamos por id (indexado)
    // a las últimas filas y lo envolvemos: si igual falla, seguimos con el resto de los chequeos.
    try {
      const recent5xx = await sql`
        select status_code, left(content, 200) as c
        from (select id, status_code, content from net._http_response order by id desc limit 2000) t
        where status_code >= 500`;
      const n = (recent5xx as any[]).length;
      if (n > 0) {
        const s = (recent5xx as any[])[0];
        issues.push({ severity: 'critical', key: 'http:5xx', title: `⚠️ ${n} errores 5xx internos (recientes)`, detail: `${s?.status_code}: ${s?.c}` });
      }
    } catch (e) {
      console.warn('[health] chequeo 5xx omitido:', String(e).slice(0, 120));
    }

    // 4) Conversaciones WhatsApp sin lead (deberían vincularse solas)
    const orphan = (await sql`select count(*)::int as n from webchat_conversations where channel='whatsapp' and lead_id is null and created_at > now() - interval '24 hours'`)[0] as any;
    if (Number(orphan.n) > 0) {
      issues.push({ severity: 'warning', key: 'conv:orphan', title: `⚠️ ${orphan.n} conversaciones WhatsApp sin lead (24h)`, detail: 'Revisar creación/vinculación de lead en el webhook.' });
    }

    // 5) Key de OpenAI (ping liviano)
    try {
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${Deno.env.get('OPENAI_API_KEY')}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'ok' }], max_tokens: 1 }),
      });
      // Distinguimos el motivo real: 401/403 = key inválida · 402/quota = SIN SALDO ·
      // 429 puro = rate limit transitorio (NO es un problema de configuración, no alarmamos igual).
      if (!r.ok) {
        const bodyTxt = await r.text().catch(() => '');
        const isQuota = /insufficient_quota|exceeded your current quota|billing/i.test(bodyTxt);
        if (r.status === 401 || r.status === 403) {
          issues.push({ severity: 'critical', key: 'ai:key', title: '⛔ Key de IA inválida', detail: `OpenAI respondió ${r.status} — la key es inválida o sin permiso. Revisá Integraciones → IA.` });
        } else if (r.status === 402 || isQuota) {
          issues.push({ severity: 'critical', key: 'ai:credits', title: '⛔ IA SIN SALDO', detail: 'Se agotaron los créditos de IA — la IA no puede responder a los clientes. Recargá para reactivarla.' });
        } else if (r.status === 429) {
          issues.push({ severity: 'warning', key: 'ai:ratelimit', title: '⚠️ IA con límite de solicitudes', detail: 'OpenAI respondió 429 (rate limit). Suele ser transitorio; si persiste, revisá el plan o bajá el ritmo de envíos.' });
        } else {
          issues.push({ severity: 'critical', key: 'ai:error', title: '⛔ La IA no responde', detail: `OpenAI respondió ${r.status}. ${bodyTxt.slice(0, 150)}` });
        }
      }
    } catch (e) {
      issues.push({ severity: 'critical', key: 'ai:key', title: '⛔ Error verificando key de IA', detail: String(e) });
    }

    // 6) Mensajes WhatsApp SALIENTES fallidos (envíos que no llegaron al cliente)
    const failedOut = (await sql`select count(*)::int as n from webchat_messages where delivery_status='failed' and direction='outbound' and created_at > now() - interval '1 hour'`)[0] as any;
    if (Number(failedOut.n) >= 5) {
      const sample = (await sql`select left(metadata->>'error',200) as e from webchat_messages where delivery_status='failed' and direction='outbound' order by created_at desc limit 1`)[0] as any;
      issues.push({ severity: 'critical', key: 'wa:send-failed', title: `⛔ ${failedOut.n} mensajes WhatsApp fallaron (1h)`, detail: `Posible conexión caída o fuera de ventana 24h. Ej: ${sample?.e || 'sin detalle'}` });
    }

    // 7) Conexiones WhatsApp caídas (avisar ANTES de que fallen los envíos)
    const downConns = await sql`
      select 'Zernio' as prov, coalesce(display_name, id::text) as name, status from zernio_connections where status is not null and status not in ('active','connected','open')
      union all
      select 'Evolution' as prov, id::text as name, status from evolution_instances
        where status is not null
          -- Solo caídas REALES: 'qr_pending'/'qrcode'/'connecting'/'created' = nunca conectada
          -- (instancia sin configurar o sin usar) → no es una caída, no alertamos.
          and status not in ('connected','open','qr_pending','qrcode','connecting','created','disconnected_by_user')`;
    for (const c of downConns as any[]) {
      issues.push({ severity: 'warning', key: `wa:conn:${c.prov}:${c.name}`, title: `⚠️ Conexión WhatsApp caída: ${c.prov}`, detail: `${c.name} — estado: ${c.status}. Los mensajes por este número pueden fallar.` });
    }

    // 8) Conversaciones EN FILA (waiting_human) que nadie tomó hace rato → quedaron "colgadas".
    const stuckQueue = (await sql`
      select count(*)::int as n from webchat_conversations
      where status = 'waiting_human'
        and status not in ('bot_active','human_active','closed')
        and assigned_user_id is null and current_agent_id is null
        and last_message_at < now() - interval '10 minutes'
        and last_message_at > now() - interval '24 hours'`)[0] as any;
    if (Number(stuckQueue.n) > 0) {
      const sample = (await sql`
        select coalesce(visitor_phone, 'cliente') as who, to_char(now() - last_message_at, 'HH24:MI') as wait
        from webchat_conversations
        where status='waiting_human' and assigned_user_id is null and current_agent_id is null
          and last_message_at < now() - interval '10 minutes' and last_message_at > now() - interval '24 hours'
        order by last_message_at asc limit 1`)[0] as any;
      issues.push({ severity: 'critical', key: 'conv:stuck-queue', title: `⛔ ${stuckQueue.n} lead(s) esperando sin atención`, detail: `Clientes en la fila que nadie tomó. Ej: ${sample?.who} esperando hace ${sample?.wait}. Entrá al inbox y atendelos.` });
    }

    // Alertar a admins por cada problema NUEVO (dedup 60 min por title)
    if (issues.length > 0) {
      const admins = await sql`select distinct ur.user_id from user_roles ur where ur.role in ('admin','manager','super_admin')`;
      const adminIds = (admins as any[]).map((a) => a.user_id).filter(Boolean);
      for (const iss of issues) {
        const recent = (await sql`select 1 from notifications where type='system' and title=${iss.title} and created_at > now() - interval '60 minutes' limit 1`);
        if (recent.length > 0) continue; // ya avisado hace poco
        for (const uid of adminIds) {
          try {
            await sql`insert into notifications (user_id, type, title, message, metadata)
              values (${uid}, 'system', ${iss.title}, ${iss.detail}, ${sql.json({ severity: iss.severity, key: iss.key })})`;
          } catch (_) { /* non-fatal */ }
        }
      }
    }

    return new Response(JSON.stringify({ ok: issues.length === 0, issues, checked_at: new Date().toISOString() }, null, 2), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    // El monitoreo NUNCA debe caerse entero: devolvemos lo que sí se pudo chequear (200)
    // + un aviso del chequeo que falló, en vez de un 500 que deja al equipo a ciegas.
    console.error('[health] chequeo parcial:', String(e));
    issues.push({ severity: 'warning', key: 'health:partial', title: '⚠️ Chequeo de salud incompleto', detail: `Un chequeo falló: ${String(e).slice(0, 200)}` });
    return new Response(JSON.stringify({ ok: false, partial: true, issues, checked_at: new Date().toISOString() }, null, 2), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } finally {
    await sql.end();
  }
});
