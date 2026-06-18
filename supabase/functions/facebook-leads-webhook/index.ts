import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  const url = new URL(req.url);
  
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );
  
  // GET = Verificação do webhook por el Facebook
  if (req.method === 'GET') {
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');
    
    console.log('Webhook verification request:', { mode, token });
    
    // Verificar token en cadas as integraciones ativas
    const { data: integration, error } = await supabase
      .from('facebook_lead_integrations')
      .select('id')
      .eq('verify_token', token)
      .eq('is_active', true)
      .maybeSingle();
    
    if (error) {
      console.error('Error verifying token:', error);
      return new Response('Verification failed', { status: 403 });
    }
    
    if (mode === 'subscribe' && integration) {
      console.log('Webhook verified for integration:', integration.id);
      return new Response(challenge, { status: 200 });
    }
    
    console.log('Verification failed - no matching integration found');
    return new Response('Verification failed', { status: 403 });
  }
  
  // POST = Receber leads
  if (req.method === 'POST') {
    try {
      const body = await req.json();
      console.log('Received webhook:', JSON.stringify(body));
      
      // Processar cada entry
      for (const entry of body.entry || []) {
        const pageId = entry.id;
        
        // Buscar integración por la page_id
        const { data: integration, error: integrationError } = await supabase
          .from('facebook_lead_integrations')
          .select('*, products(*)')
          .eq('page_id', pageId)
          .eq('is_active', true)
          .maybeSingle();
        
        if (integrationError) {
          console.error('Error fetching integration:', integrationError);
          continue;
        }
        
        if (!integration) {
          console.log('No integration found for page:', pageId);
          continue;
        }
        
        // Processar cada mudança (lead)
        for (const change of entry.changes || []) {
          if (change.field !== 'leadgen') continue;
          
          const leadgenId = change.value.leadgen_id;
          const formId = change.value.form_id;
          const adId = change.value.ad_id;
          
          console.log('Processing lead:', { leadgenId, formId, adId });
          
          // Logar recibímento
          const { data: log, error: logError } = await supabase
            .from('facebook_lead_logs')
            .insert({
              integration_id: integration.id,
              leadgen_id: leadgenId,
              form_id: formId,
              ad_id: adId,
              raw_payload: change.value,
              status: 'pending'
            })
            .select()
            .single();
          
          if (logError) {
            console.error('Error creating log:', logError);
            continue;
          }
          
          // Buscar dados del lead na Graph API
          const leadData = await fetchLeadData(
            leadgenId, 
            integration.page_access_token
          );
          
          if (!leadData) {
            await supabase
              .from('facebook_lead_logs')
              .update({ 
                status: 'error', 
                error_message: 'Failed to fetch lead data from Graph API' 
              })
              .eq('id', log.id);
            continue;
          }
          
          // Mapear campos
          const fieldMapping = integration.field_mapping as Record<string, string> || {};
          const mappedData = mapLeadFields(leadData, fieldMapping);
          
          console.log('Mapped lead data:', mappedData);
          
          // Criar lead no CRM
          const lead = await createLeadFromFacebook(
            supabase, 
            integration, 
            mappedData, 
            leadData
          );
          
          // Atualizar log
          await supabase
            .from('facebook_lead_logs')
            .update({
              lead_data: leadData,
              lead_id: lead?.id,
              status: lead ? 'processed' : 'error',
              error_message: lead ? null : 'Failed to create lead',
              processed_at: new Date().toISOString()
            })
            .eq('id', log.id);
          
          // Atualizar contadores
          if (lead) {
            await supabase
              .from('facebook_lead_integrations')
              .update({
                last_lead_received_at: new Date().toISOString(),
                leads_count: (integration.leads_count || 0) + 1
              })
              .eq('id', integration.id);
            
            console.log('Lead created successfully:', lead.id);

            // 🚀 Primer contacto automático por WhatsApp (Evolution). La IA toma la
            // conversación con el contexto del anuncio y el formulario ya cargado.
            await triggerFirstContact(supabase, integration, lead);
          }
        }
      }
      
      return new Response('EVENT_RECEIVED', { status: 200 });
    } catch (error) {
      console.error('Error processing webhook:', error);
      return new Response('Error', { status: 500 });
    }
  }
  
  return new Response('Method not allowed', { status: 405 });
});

async function fetchLeadData(leadgenId: string, accessToken: string) {
  const url = `https://graph.facebook.com/v18.0/${leadgenId}?access_token=${accessToken}`;
  
  try {
    const response = await fetch(url);
    if (!response.ok) {
      const errorText = await response.text();
      console.error('Error fetching lead from Graph API:', errorText);
      return null;
    }
    
    return await response.json();
  } catch (error) {
    console.error('Exception fetching lead data:', error);
    return null;
  }
}

function mapLeadFields(leadData: any, fieldMapping: Record<string, string>) {
  const result: Record<string, string> = {};
  
  for (const field of leadData.field_data || []) {
    const fbField = field.name;
    const crmField = fieldMapping[fbField] || fbField;
    const value = field.values?.[0] || '';
    
    result[crmField] = value;
  }
  
  return result;
}

async function createLeadFromFacebook(
  supabase: any,
  integration: any,
  mappedData: Record<string, string>,
  rawLeadData: any
) {
  try {
    // Buscar primero estágio do pipeline
    const { data: firstStage } = await supabase
      .from('pipeline_stages')
      .select('id')
      .eq('product_id', integration.product_id)
      .order('order_index')
      .limit(1)
      .maybeSingle();
    
    const leadName = mappedData.name || mappedData.full_name || mappedData.email || 'Lead Facebook';
    
    const { data: lead, error } = await supabase
      .from('leads')
      .insert({
        organization_id: integration.organization_id,
        product_id: integration.product_id,
        name: leadName,
        email: mappedData.email || null,
        phone: mappedData.phone || mappedData.phone_number || null,
        company: mappedData.company || null,
        temperature: integration.default_temperature || 'hot',
        lead_origin: 'facebook_ads',
        lead_channel: 'facebook',
        source: 'Facebook Lead Ads',
        current_stage_id: firstStage?.id || null,
        assigned_to: integration.assigned_user_id || null,
        squad_id: integration.assigned_squad_id || null,
        utm_source: 'facebook',
        utm_medium: 'paid',
        utm_campaign: rawLeadData.campaign_name || null,
        metadata: {
          facebook_leadgen_id: rawLeadData.id,
          facebook_form_id: rawLeadData.form_id,
          facebook_ad_id: rawLeadData.ad_id,
          facebook_ad_name: rawLeadData.ad_name,
          facebook_campaign_name: rawLeadData.campaign_name,
          raw_field_data: rawLeadData.field_data,
          tags: integration.default_tags || []
        }
      })
      .select()
      .single();
    
    if (error) {
      console.error('Error creating lead:', error);
      return null;
    }
    
    // Criar interacción
    await supabase.from('interactions').insert({
      lead_id: lead.id,
      channel: 'other',
      direction: 'inbound',
      content: `Lead capturado via Facebook Lead Ads`,
      metadata: { type: 'facebook_lead_capture' }
    });

    return lead;
  } catch (error) {
    console.error('Exception creating lead:', error);
    return null;
  }
}

// Primer contacto automático: crea una conversación de WhatsApp y envía un saludo por
// Evolution. La IA continúa desde ahí (webchat-bot ya inyecta el contexto del anuncio/formulario).
async function triggerFirstContact(supabase: any, integration: any, lead: any) {
  try {
    if (integration.auto_first_contact === false) {
      console.log('[fb-leads] auto_first_contact desactivado, no se contacta');
      return;
    }
    const phone = String(lead.phone || '').replace(/\D/g, '');
    if (!phone) {
      console.log('[fb-leads] lead sin teléfono, no se puede contactar');
      return;
    }

    // Instancia de WhatsApp (Evolution) conectada de la organización
    const { data: instance } = await supabase
      .from('evolution_instances')
      .select('id, instance_id')
      .eq('organization_id', integration.organization_id)
      .eq('status', 'connected')
      .limit(1)
      .maybeSingle();
    if (!instance) {
      console.log('[fb-leads] sin instancia de WhatsApp conectada, no se contacta');
      return;
    }

    // Agente del producto (default/primero activo) que conducirá la conversación
    const { data: agent } = await supabase
      .from('product_agents')
      .select('id, name')
      .eq('organization_id', integration.organization_id)
      .eq('product_id', integration.product_id)
      .eq('is_active', true)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    // No duplicar: si ya hay conversación para este teléfono, reusarla
    const { data: existingConv } = await supabase
      .from('webchat_conversations')
      .select('id')
      .eq('organization_id', integration.organization_id)
      .eq('visitor_phone', phone)
      .limit(1)
      .maybeSingle();

    let conversationId: string | null = existingConv?.id || null;
    if (!conversationId) {
      const { data: conv, error: convErr } = await supabase
        .from('webchat_conversations')
        .insert({
          organization_id: integration.organization_id,
          channel: 'whatsapp',
          visitor_name: lead.name || null,
          visitor_phone: phone,
          visitor_id: `wa-${phone}`,
          evolution_instance_id: instance.id,
          lead_id: lead.id,
          current_agent_id: agent?.id || null,
          product_id: integration.product_id,
          status: 'bot_active',
          orchestrator_state: 'em_atendimento',
          welcome_sent_at: new Date().toISOString(),
        })
        .select('id')
        .single();
      if (convErr) {
        console.error('[fb-leads] error creando conversación:', convErr.message);
        return;
      }
      conversationId = conv.id;
    }

    // Saludo personalizado (mensaje custom de la integración, o uno generado con el contexto)
    const meta = (lead.metadata as any) || {};
    const firstName = String(lead.name || '').trim().split(/\s+/)[0] || '';
    const adRef = meta.facebook_ad_name || integration.products?.name || '';
    const agentName = agent?.name || '';
    let greeting: string = integration.first_contact_message || '';
    if (greeting.trim()) {
      greeting = greeting
        .split('{nombre}').join(firstName)
        .split('{anuncio}').join(adRef)
        .split('{agente}').join(agentName);
    } else {
      greeting = `¡Hola${firstName ? ' ' + firstName : ''}! 👋${agentName ? ` Soy ${agentName}.` : ''} Vi que dejaste tus datos en nuestro anuncio${adRef ? ` sobre ${adRef}` : ''}. ¿Te gustaría que te cuente más y coordinemos una visita o un test drive?`;
    }

    // Enviar por Evolution
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const sendRes = await fetch(`${supabaseUrl}/functions/v1/evolution-send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}`, apikey: serviceKey },
      body: JSON.stringify({
        organization_id: integration.organization_id,
        instance_id: instance.id,
        type: 'text',
        to: phone,
        payload: { text: greeting },
      }),
    });

    // Reflejar el saludo en el inbox
    await supabase.from('webchat_messages').insert({
      conversation_id: conversationId,
      direction: 'outbound',
      sender_type: 'bot',
      content: greeting,
      message_type: 'text',
      metadata: { source: 'facebook_lead_first_contact', ad: adRef },
    });

    console.log('[fb-leads] primer contacto enviado a', phone, '| send status:', sendRes.status);
  } catch (e: any) {
    console.error('[fb-leads] triggerFirstContact exception:', e?.message || String(e));
  }
}
