// zernio-templates
// Gestión de plantillas (HSM) de Zernio desde Vendus: listar / crear / borrar.
// Las plantillas son necesarias para escribir FUERA de la ventana de 24h
// (follow-ups, reenganche). Requiere usuario autenticado de la organización.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { decryptSecret } from '../_shared/meta-crypto.ts';

const ZERNIO_BASE = 'https://zernio.com/api/v1';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Unauthorized' }, 401);

  const sbUser = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
  const sbAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const { data: userData, error: userErr } = await sbUser.auth.getUser();
  if (userErr || !userData?.user) return json({ error: 'Unauthorized' }, 401);
  const userId = userData.user.id;

  const body = await req.json().catch(() => ({}));
  const { organization_id, connection_id, action } = body ?? {};
  if (!organization_id || !connection_id || !action) return json({ error: 'organization_id, connection_id y action requeridos' }, 400);

  const { data: belongs } = await sbAdmin.rpc('user_belongs_to_organization', { _user_id: userId, _org_id: organization_id });
  if (!belongs) return json({ error: 'forbidden' }, 403);

  const { data: conn } = await sbAdmin
    .from('zernio_connections').select('account_id, api_key_encrypted, organization_id')
    .eq('id', connection_id).maybeSingle();
  if (!conn || conn.organization_id !== organization_id) return json({ error: 'connection not found' }, 404);

  const apiKey = await decryptSecret(conn.api_key_encrypted);
  const accountId = conn.account_id as string;
  const zfetch = async (method: string, path: string, payload?: unknown) => {
    const r = await fetch(`${ZERNIO_BASE}${path}`, {
      method,
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: payload ? JSON.stringify(payload) : undefined,
    });
    const txt = await r.text();
    let data: any; try { data = JSON.parse(txt); } catch { data = txt; }
    return { ok: r.ok, status: r.status, data };
  };

  if (action === 'list') {
    const r = await zfetch('GET', `/whatsapp/templates?accountId=${accountId}`);
    if (!r.ok) return json({ ok: false, error: r.data?.error ?? `status ${r.status}` }, 200);
    return json({ ok: true, templates: r.data?.templates ?? [] });
  }

  if (action === 'create') {
    const { name, category, language, body_text, header_text, footer_text, buttons, components } = body ?? {};
    if (!name || !category || !language) return json({ error: 'name, category y language requeridos' }, 400);
    if (!/^[a-z][a-z0-9_]*$/.test(name)) return json({ error: 'name inválido: minúsculas, letras/números/_ y debe empezar con letra' }, 400);

    // Construir components si no vienen ya armados
    let comps = components;
    if (!comps) {
      comps = [];
      if (header_text) comps.push({ type: 'HEADER', format: 'TEXT', text: header_text });
      comps.push({ type: 'BODY', text: body_text || '' });
      if (footer_text) comps.push({ type: 'FOOTER', text: footer_text });
      if (Array.isArray(buttons) && buttons.length > 0) {
        comps.push({ type: 'BUTTONS', buttons });
      }
    }

    const r = await zfetch('POST', '/whatsapp/templates', {
      accountId, name, category, language, components: comps,
    });
    if (!r.ok) return json({ ok: false, error: r.data?.error ?? `status ${r.status}`, detail: r.data }, 200);
    return json({ ok: true, template: r.data?.template ?? r.data });
  }

  if (action === 'delete') {
    const { name } = body ?? {};
    if (!name) return json({ error: 'name requerido' }, 400);
    const r = await zfetch('DELETE', `/whatsapp/templates/${encodeURIComponent(name)}?accountId=${accountId}`);
    if (!r.ok) return json({ ok: false, error: r.data?.error ?? `status ${r.status}` }, 200);
    return json({ ok: true });
  }

  return json({ error: `action desconocida: ${action}` }, 400);
});
