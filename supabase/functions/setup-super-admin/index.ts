import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const fullName = String(body?.fullName ?? "").trim();
    const email = String(body?.email ?? "").trim().toLowerCase();
    const password = String(body?.password ?? "");
    const companyName = String(body?.companyName ?? "").trim();
    const phone = String(body?.phone ?? "").trim();

    if (!fullName) return json(400, { ok: false, error: "Nombre é obligatorio" });
    if (!email || !/^\S+@\S+\.\S+$/.test(email))
      return json(400, { ok: false, error: "Email inválido" });
    if (!password || password.length < 8)
      return json(400, { ok: false, error: "Contraseña precisa de no mínimo 8 caracteres" });

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Trava de segurança: só permite se NÃO existe ningún super_admin
    const { data: existing, error: checkErr } = await admin
      .from("user_roles")
      .select("user_id")
      .eq("role", "super_admin")
      .limit(1);
    if (checkErr) throw checkErr;
    if ((existing?.length ?? 0) > 0) {
      return json(409, { ok: false, error: "Super Admin já fue configurado" });
    }

    // Cria o usuario (auto-confirmado)
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    if (createErr) throw createErr;
    const userId = created.user?.id;
    if (!userId) throw new Error("Falha ao crear usuario");

    // Garante profile (trigger normalmente cria, blindamos)
    await admin
      .from("profiles")
      .upsert(
        {
          id: userId,
          full_name: fullName,
          email,
          phone: phone || null,
          is_active: true,
        },
        { onConflict: "id" },
      );

    // Organização opcional
    let organizationId: string | null = null;
    if (companyName) {
      const { data: org, error: orgErr } = await admin
        .from("organizations")
        .insert({
          name: companyName,
          email,
          phone: phone || null,
          owner_id: userId,
          status: "active",
        })
        .select("id")
        .single();
      if (orgErr) throw orgErr;
      organizationId = org.id;
      await admin
        .from("profiles")
        .update({ organization_id: organizationId })
        .eq("id", userId);
    }

    // Papéis
    await admin
      .from("user_roles")
      .upsert({ user_id: userId, role: "super_admin" }, { onConflict: "user_id,role" });
    await admin
      .from("user_roles")
      .upsert({ user_id: userId, role: "admin" }, { onConflict: "user_id,role" });

    // Marca lock permanente em platform_settings
    const { data: settings } = await admin
      .from("platform_settings")
      .select("id")
      .maybeSingle();
    const payload = {
      super_admin_bootstrapped: true,
      super_admin_bootstrapped_at: new Date().toISOString(),
      default_password_changed: true,
      remix_setup_completed: true,
    };
    if (settings?.id) {
      await admin.from("platform_settings").update(payload).eq("id", settings.id);
    } else {
      await admin.from("platform_settings").insert(payload);
    }

    return json(200, { ok: true, user_id: userId, organization_id: organizationId });
  } catch (err) {
    console.error("[setup-super-admin] error:", err);
    return json(500, { ok: false, error: (err as Error).message });
  }
});
