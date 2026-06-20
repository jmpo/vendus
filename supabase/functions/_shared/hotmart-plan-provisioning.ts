// Provisiona el plan de la plataforma a partir de una venta Hotmart (billing de plataforma).
// Mirror del patrón de cakto-plan-provisioning. Reusa ensureAdminUser (provider-agnóstico).
import { type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { ensureAdminUser } from './cakto-plan-provisioning.ts';

export interface HotmartOrderLike {
  hotmart_transaction_id?: string | null;   // transaction (compra)
  hotmart_subscription_code?: string | null; // suscripción (recurrente)
  customer_email?: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  amount?: number | null;
  status?: string | null;                    // 'paid'/'approved' para activar
  hotmart_product_id?: string | null;        // id del producto Hotmart (mapea al plan)
  product_name?: string | null;
}

interface ProvisionResult { ok: boolean; organization_id?: string; plan_id?: string; user_id?: string; skipped?: string; errors?: string[]; }

async function resolvePlanByHotmartProduct(admin: SupabaseClient, productId: string | null) {
  if (!productId) return null;
  const { data } = await admin
    .from('platform_plans')
    .select('id, name, slug, price_monthly, hotmart_product_id')
    .eq('hotmart_product_id', productId)
    .maybeSingle();
  return data ?? null;
}

export async function provisionPlatformPlanHotmart(admin: SupabaseClient, order: HotmartOrderLike): Promise<ProvisionResult> {
  const errors: string[] = [];
  const email = (order.customer_email || '').trim().toLowerCase();
  if (!email) return { ok: false, skipped: 'missing customer_email' };

  const status = (order.status || '').toLowerCase();
  if (status !== 'paid' && status !== 'approved' && status !== 'compra_aprovada') {
    return { ok: false, skipped: `status=${status}` };
  }

  const plan = await resolvePlanByHotmartProduct(admin, order.hotmart_product_id ?? null);
  if (!plan) return { ok: false, skipped: `plan not found (product=${order.hotmart_product_id ?? '-'})` };

  // 1) Localiza/crea la organización por email
  let orgId: string | null = null;
  const { data: existingOrg } = await admin
    .from('organizations')
    .select('id')
    .eq('hotmart_customer_email', email)
    .maybeSingle();
  if (existingOrg) {
    orgId = existingOrg.id;
  } else {
    const { data: created, error: createErr } = await admin
      .from('organizations')
      .insert({ name: order.customer_name || email, email, hotmart_customer_email: email, status: 'active' })
      .select('id')
      .single();
    if (createErr || !created) { errors.push(`org create: ${createErr?.message ?? 'unknown'}`); return { ok: false, errors }; }
    orgId = created.id;
  }

  // 2) Activa el plan
  const { error: planErr } = await admin
    .from('organizations')
    .update({
      plan_id: plan.id,
      plan_status: 'active',
      plan_activated_at: new Date().toISOString(),
      hotmart_subscription_id: order.hotmart_subscription_code ?? order.hotmart_transaction_id ?? null,
    })
    .eq('id', orgId);
  if (planErr) errors.push(`plan update: ${planErr.message}`);

  // 3) billing_history idempotente (metadata.hotmart_id)
  const txId = order.hotmart_transaction_id ?? order.hotmart_subscription_code ?? null;
  if (txId) {
    const { data: existingBill } = await admin
      .from('billing_history')
      .select('id')
      .eq('organization_id', orgId)
      .filter('metadata->>hotmart_id', 'eq', txId)
      .maybeSingle();
    if (!existingBill) {
      const { error: billErr } = await admin.from('billing_history').insert({
        organization_id: orgId,
        amount: order.amount ?? plan.price_monthly ?? 0,
        status: 'paid',
        description: `Plan ${plan.name} — Hotmart`,
        payment_date: new Date().toISOString(),
        metadata: { hotmart_id: txId, source: 'hotmart' } as any,
      });
      if (billErr) errors.push(`billing: ${billErr.message}`);
    }
  }

  return { ok: errors.length === 0, organization_id: orgId, plan_id: plan.id, errors };
}

/** Suspende el plan de la org (cancelación / reembolso). */
export async function suspendPlatformPlanHotmart(admin: SupabaseClient, email: string): Promise<ProvisionResult> {
  const e = (email || '').trim().toLowerCase();
  if (!e) return { ok: false, skipped: 'missing email' };
  const { data: org } = await admin.from('organizations').select('id').eq('hotmart_customer_email', e).maybeSingle();
  if (!org) return { ok: false, skipped: 'org not found' };
  const { error } = await admin.from('organizations').update({ plan_status: 'suspended' }).eq('id', org.id);
  return { ok: !error, organization_id: org.id, errors: error ? [error.message] : undefined };
}

/** Pipeline completo: plan + usuario admin + email de bienvenida. */
export async function provisionFromHotmartOrder(admin: SupabaseClient, order: HotmartOrderLike): Promise<ProvisionResult> {
  const planRes = await provisionPlatformPlanHotmart(admin, order);
  if (!planRes.ok || !planRes.organization_id) return planRes;
  const plan = await resolvePlanByHotmartProduct(admin, order.hotmart_product_id ?? null);
  const userRes = await ensureAdminUser(admin, {
    email: order.customer_email!,
    fullName: order.customer_name ?? null,
    phone: order.customer_phone ?? null,
    organizationId: planRes.organization_id,
    planName: plan?.name ?? null,
  });
  return { ...planRes, user_id: userRes.user_id, ok: planRes.ok && userRes.ok, errors: [...(planRes.errors ?? []), ...(userRes.errors ?? [])] };
}
