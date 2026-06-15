// instagram-connect
// Promove uma conexão Instagram em rascunho para ATIVA.
// Valida credenciais via Graph API, criptografa segredos e inscreve a página no app.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { graphFetch, GraphError } from '../_shared/meta-graph.ts';
import { encryptSecret } from '../_shared/meta-crypto.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Unauthorized' }, 401);

  const sbUser = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const sbAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: userData, error: userErr } = await sbUser.auth.getUser();
  if (userErr || !userData?.user) return json({ error: 'Unauthorized' }, 401);
  const userId = userData.user.id;

  const body = await req.json().catch(() => ({}));
  const {
    connection_id,
    organization_id,
    display_name,
    app_id,
    app_secret,
    fb_page_id,
    ig_business_account_id,
    page_access_token,
  } = body ?? {};

  if (!connection_id || !organization_id || !app_id || !fb_page_id || !ig_business_account_id || !page_access_token) {
    return json({ error: 'campos obrigatórios ausentes' }, 400);
  }

  const { data: belongs, error: belongsErr } = await sbAdmin.rpc('user_belongs_to_organization', {
    _user_id: userId,
    _org_id: organization_id,
  });
  if (belongsErr) return json({ error: belongsErr.message }, 500);
  if (!belongs) return json({ error: 'forbidden' }, 403);

  const { data: existing } = await sbAdmin
    .from('instagram_connections')
    .select('id, status, app_secret_encrypted')
    .eq('id', connection_id)
    .eq('organization_id', organization_id)
    .maybeSingle();
  if (!existing) return json({ error: 'connection not found' }, 404);

  // Valida Page Access Token e dados via Graph
  let pageInfo: any, igInfo: any;
  try {
    pageInfo = await graphFetch(`/${fb_page_id}?fields=name,id,instagram_business_account`, page_access_token);
  } catch (e) {
    const ge = e as GraphError;
    return json({ error: 'Facebook Page ID ou Page Access Token inválido', detail: ge.graph?.message ?? String(e) }, 400);
  }
  if (pageInfo?.instagram_business_account?.id && String(pageInfo.instagram_business_account.id) !== String(ig_business_account_id)) {
    return json({ error: `A cuenta IG da página é ${pageInfo.instagram_business_account.id}, no ${ig_business_account_id}` }, 400);
  }
  try {
    igInfo = await graphFetch(`/${ig_business_account_id}?fields=username,name`, page_access_token);
  } catch (e) {
    const ge = e as GraphError;
    return json({ error: 'Instagram Business Account ID inválido', detail: ge.graph?.message ?? String(e) }, 400);
  }

  // Inscreve a página no app (best-effort)
  let subscribedOk = true;
  try {
    await graphFetch(
      `/${fb_page_id}/subscribed_apps?subscribed_fields=messages,messaging_postbacks,message_reactions`,
      page_access_token,
      { method: 'POST' },
    );
  } catch (e) {
    subscribedOk = false;
    console.error('[ig-connect] subscribed_apps failed', (e as GraphError).graph);
  }

  const updates: Record<string, any> = {
    display_name: display_name ?? undefined,
    app_id: String(app_id),
    fb_page_id: String(fb_page_id),
    fb_page_name: pageInfo?.name ?? null,
    ig_business_account_id: String(ig_business_account_id),
    ig_username: igInfo?.username ?? null,
    page_access_token_encrypted: await encryptSecret(String(page_access_token)),
    status: 'active',
    last_error: null,
  };
  if (app_secret) updates.app_secret_encrypted = await encryptSecret(String(app_secret));
  else if (!existing.app_secret_encrypted) {
    return json({ error: 'app_secret é obligatorio na primeira ativação' }, 400);
  }

  const { error: updErr } = await sbAdmin
    .from('instagram_connections')
    .update(updates)
    .eq('id', connection_id);
  if (updErr) return json({ error: updErr.message }, 500);

  return json({
    ok: true,
    connection_id,
    ig_username: igInfo?.username ?? null,
    fb_page_name: pageInfo?.name ?? null,
    subscribed: subscribedOk,
  });
});
