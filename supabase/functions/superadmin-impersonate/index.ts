// superadmin-impersonate
// Genera una sesión temporal del admin de una organización para que el SUPER ADMIN
// dé soporte "viendo como" el cliente. Seguro:
//   - valida que QUIEN llama sea super_admin (rol),
//   - registra en platform_audit_logs (quién impersonó a qué org y cuándo),
//   - devuelve un token de magic-link que el frontend canjea por la sesión del cliente.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // 1) Identificar al que llama y validar super_admin
  const authHeader = req.headers.get('Authorization') || '';
  const jwt = authHeader.replace('Bearer ', '');
  if (!jwt) return json({ error: 'no auth' }, 401);
  const { data: caller, error: callerErr } = await admin.auth.getUser(jwt);
  if (callerErr || !caller?.user) return json({ error: 'invalid session' }, 401);

  const { data: callerRoles } = await admin.from('user_roles').select('role').eq('user_id', caller.user.id);
  const isSuper = (callerRoles || []).some((r: any) => r.role === 'super_admin');
  if (!isSuper) return json({ error: 'forbidden — solo super admin' }, 403);

  // 2) Org objetivo + un usuario admin de esa org
  const { organization_id } = (await req.json().catch(() => ({}))) as { organization_id?: string };
  if (!organization_id) return json({ error: 'organization_id requerido' }, 400);

  const { data: org } = await admin.from('organizations').select('name').eq('id', organization_id).maybeSingle();
  const { data: members } = await admin.from('profiles').select('id').eq('organization_id', organization_id);
  const memberIds = (members || []).map((m: any) => m.id);
  if (memberIds.length === 0) return json({ error: 'la organización no tiene usuarios' }, 404);

  let targetId: string | null = null;
  const { data: adminRole } = await admin.from('user_roles').select('user_id').in('user_id', memberIds).eq('role', 'admin').limit(1).maybeSingle();
  targetId = adminRole?.user_id || memberIds[0];

  const { data: targetUser, error: tErr } = await admin.auth.admin.getUserById(targetId!);
  if (tErr || !targetUser?.user?.email) return json({ error: 'no pude resolver el usuario objetivo' }, 404);
  const targetEmail = targetUser.user.email;

  // 3) Generar magic link (token) para ese usuario
  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({ type: 'magiclink', email: targetEmail });
  if (linkErr || !linkData?.properties?.hashed_token) return json({ error: 'no pude generar el acceso', detail: linkErr?.message }, 500);

  // 4) Auditoría
  try {
    await admin.from('platform_audit_logs').insert({
      actor_id: caller.user.id,
      action: 'impersonate_start',
      entity_type: 'organization',
      entity_id: organization_id,
      metadata: { target_user_id: targetId, target_email: targetEmail, org_name: org?.name ?? null },
      ip_address: req.headers.get('x-forwarded-for') || null,
    });
  } catch (_) { /* non-fatal */ }

  return json({
    ok: true,
    token_hash: linkData.properties.hashed_token,
    email: targetEmail,
    target_user_id: targetId,
    org_name: org?.name ?? 'Organización',
  });
});
