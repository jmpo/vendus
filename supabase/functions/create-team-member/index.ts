import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CreateMemberPayload {
  email: string;
  password: string;
  full_name: string;
  role: 'admin' | 'manager' | 'seller';
  recovery_whatsapp?: string;
  sector_ids?: string[];
  default_connection_id?: string | null;
  work_start_time?: string;
  work_end_time?: string;
  farewell_message?: string;
  default_theme?: string;
  default_menu_state?: string;
  avatar_url?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Não autenticado' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Verify caller using anon client
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: caller } } = await userClient.auth.getUser();
    if (!caller) {
      return new Response(JSON.stringify({ error: 'Sessão inválida' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Caller's profile + role check
    const { data: callerProfile } = await admin
      .from('profiles')
      .select('organization_id')
      .eq('id', caller.id)
      .maybeSingle();

    if (!callerProfile?.organization_id) {
      return new Response(JSON.stringify({ error: 'Sem organização' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: roles } = await admin
      .from('user_roles')
      .select('role')
      .eq('user_id', caller.id);
    const callerRoles = (roles || []).map((r: any) => r.role);
    if (!callerRoles.some((r: string) => ['admin', 'manager', 'super_admin'].includes(r))) {
      return new Response(JSON.stringify({ error: 'Permissão negada' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = (await req.json()) as CreateMemberPayload;
    if (!body.email || !body.password || !body.full_name || !body.role) {
      return new Response(JSON.stringify({ error: 'Campos obrigatórios ausentes' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Create user
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: body.email,
      password: body.password,
      email_confirm: true,
      user_metadata: { full_name: body.full_name },
    });

    if (createErr || !created.user) {
      return new Response(JSON.stringify({ error: createErr?.message || 'Erro ao criar usuário' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const newUserId = created.user.id;
    const orgId = callerProfile.organization_id;

    const fail = (step: string, message: string, extra?: unknown) => {
      console.error(`[create-team-member] step=${step}`, message, extra ?? '');
      return new Response(
        JSON.stringify({ error: message, step }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    };

    let resolvedConnectionId: string | null = body.default_connection_id || null;
    if (!resolvedConnectionId) {
      const { data: firstInstance } = await admin
        .from('evolution_instances')
        .select('id')
        .eq('organization_id', orgId)
        .limit(1)
        .maybeSingle();
      resolvedConnectionId = firstInstance?.id || null;
    }

    const { error: profErr } = await admin.from('profiles').update({
      full_name: body.full_name,
      organization_id: orgId,
      recovery_whatsapp: body.recovery_whatsapp || null,
      work_start_time: body.work_start_time || '00:00',
      work_end_time: body.work_end_time || '23:59',
      farewell_message: body.farewell_message || null,
      default_theme: body.default_theme || 'system',
      default_menu_state: body.default_menu_state || 'open',
      default_connection_id: resolvedConnectionId,
      avatar_url: body.avatar_url || null,
    }).eq('id', newUserId);
    if (profErr) return fail('update_profile', profErr.message, profErr);

    const { error: delErr } = await admin.from('user_roles').delete().eq('user_id', newUserId);
    if (delErr) return fail('delete_user_roles', delErr.message, delErr);

    const { error: roleErr } = await admin
      .from('user_roles')
      .insert({ user_id: newUserId, role: body.role });
    if (roleErr) {
      const msg = /invalid input value for enum/i.test(roleErr.message)
        ? `O perfil "${body.role}" não existe no banco. Rode as migrations do projeto antes de criar usuários.`
        : roleErr.message;
      return fail('insert_user_role', msg, roleErr);
    }

    // Permissões + notification settings (não-fatal: parceiros podem ter banco incompleto)
    const { error: permErr } = await admin.rpc('initialize_user_permissions', {
      p_user_id: newUserId,
      p_organization_id: orgId,
      p_role: body.role,
    });
    if (permErr) {
      console.warn('[create-team-member] initialize_user_permissions falhou (não-fatal):', permErr.message);
    }

    if (body.sector_ids && body.sector_ids.length > 0) {
      const { error: secErr } = await admin.from('sector_members').insert(
        body.sector_ids.map((sid) => ({ sector_id: sid, user_id: newUserId }))
      );
      if (secErr) {
        console.warn('[create-team-member] sector_members falhou (não-fatal):', secErr.message);
      }
    }

    return new Response(JSON.stringify({ success: true, user_id: newUserId }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('create-team-member error:', err);
    return new Response(JSON.stringify({ error: err.message || 'Erro interno', step: 'unknown' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
