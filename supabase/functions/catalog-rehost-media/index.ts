// catalog-rehost-media
// Baja a Supabase Storage (bucket catalog-media) cualquier imagen/video/PDF de un ítem de catálogo
// que apunte a una URL EXTERNA, y reescribe el ítem para que use la URL de Storage.
// Motivo: si el ítem guarda una URL ajena (ej: citroen.com.py), al enviar la foto el proveedor
// (Zernio/Meta) tiene que ir a buscarla a ese servidor en el momento → lento y frágil. Con la
// imagen ya en NUESTRO Storage (CDN), el envío es rápido y no depende de terceros.
//
// Uso:
//   { item_id }                                  → rehospeda un ítem
//   { organization_id, product_id?, limit? }     → backfill de varios ítems
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";

const BUCKET = "catalog-media";
const MAX_BYTES = 25 * 1024 * 1024; // 25MB (cubre videos/PDF; imágenes son mucho menores)
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

function isHttp(u: unknown): u is string {
  return typeof u === "string" && /^https?:\/\//i.test(u);
}

// ¿La URL ya vive en nuestro Storage? Entonces no la tocamos.
function alreadyHosted(u: string): boolean {
  return u.includes(`/storage/v1/object/public/${BUCKET}/`) || u.includes(`/storage/v1/object/sign/${BUCKET}/`);
}

function extFromContentType(ct: string, fallbackUrl: string): string {
  const c = (ct || "").toLowerCase();
  if (c.includes("jpeg") || c.includes("jpg")) return "jpg";
  if (c.includes("png")) return "png";
  if (c.includes("webp")) return "webp";
  if (c.includes("gif")) return "gif";
  if (c.includes("mp4")) return "mp4";
  if (c.includes("quicktime") || c.includes("mov")) return "mov";
  if (c.includes("pdf")) return "pdf";
  const m = fallbackUrl.split("?")[0].match(/\.([a-z0-9]{2,4})$/i);
  return m ? m[1].toLowerCase() : "bin";
}

function isMediaContentType(ct: string): boolean {
  return /^(image|video|audio|application\/pdf|application\/octet-stream)/i.test(ct || "");
}

async function sha16(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const body = await req.json().catch(() => ({}));
  const { item_id, organization_id, product_id, limit } = body ?? {};

  // 1) Resolver el set de ítems a procesar.
  let items: any[] = [];
  if (item_id) {
    const { data } = await supabase.from("product_catalog_items").select("*").eq("id", item_id).maybeSingle();
    if (data) items = [data];
  } else if (organization_id) {
    let q = supabase.from("product_catalog_items").select("*").eq("organization_id", organization_id);
    if (product_id) q = q.eq("product_id", product_id);
    const { data } = await q.limit(typeof limit === "number" ? limit : 500);
    items = data || [];
  } else {
    return json({ error: "se requiere item_id o organization_id" }, 400);
  }

  const reoptimize = body?.reoptimize === true;

  // Re-procesa una imagen YA hosteada (reduce tamaño) sobreescribiendo el MISMO path → la URL no cambia.
  const reoptimizeHosted = async (url: string): Promise<boolean> => {
    if (!/\.(png|jpe?g)(\?|$)/i.test(url)) return false;
    try {
      const fmt = /\.png(\?|$)/i.test(url) ? "png" : "jpg";
      const r = await fetch(`https://wsrv.nl/?url=${encodeURIComponent(url)}&output=${fmt}&w=1600&q=82&we`, { redirect: "follow" });
      if (!r.ok) return false;
      const buf = new Uint8Array(await r.arrayBuffer());
      if (buf.byteLength === 0 || buf.byteLength > MAX_BYTES) return false;
      const marker = `/object/public/${BUCKET}/`;
      const idx = url.indexOf(marker);
      if (idx < 0) return false;
      const path = decodeURIComponent(url.substring(idx + marker.length).split("?")[0]);
      const { error } = await supabase.storage.from(BUCKET).upload(path, buf, {
        upsert: true, contentType: fmt === "png" ? "image/png" : "image/jpeg",
      });
      return !error;
    } catch { return false; }
  };

  // Baja una URL externa a Storage; devuelve la nueva URL pública (o la original si falla / ya está hosteada).
  const rehostUrl = async (url: string, org: string, prod: string | null): Promise<{ url: string; changed: boolean }> => {
    if (!isHttp(url)) return { url, changed: false };
    if (alreadyHosted(url)) {
      if (reoptimize) { const did = await reoptimizeHosted(url); if (did) mediaReoptimized++; }
      return { url, changed: false };
    }
    try {
      // Para IMÁGENES pasamos por wsrv.nl (solo al rehospedar, NO en el envío) para:
      //  - redimensionar a máx 1600px y comprimir (q=82) → de ~8MB a ~200-400KB: más rápido y confiable en WhatsApp.
      //  - convertir webp/avif → jpg (nativo de WhatsApp).
      //  - PNG se mantiene PNG (preserva transparencia de los visualizadores de autos).
      const lower = url.split("?")[0].toLowerCase();
      const wsrv = (fmt: string) => `https://wsrv.nl/?url=${encodeURIComponent(url)}&output=${fmt}&w=1600&q=82&we`;
      let fetchUrl = url;
      let forcedExt: string | null = null;
      let forcedCt: string | null = null;
      if (/\.(webp|avif)$/.test(lower)) { fetchUrl = wsrv("jpg"); forcedExt = "jpg"; forcedCt = "image/jpeg"; }
      else if (/\.png$/.test(lower)) { fetchUrl = wsrv("png"); forcedExt = "png"; forcedCt = "image/png"; }
      else if (/\.(jpe?g)$/.test(lower)) { fetchUrl = wsrv("jpg"); forcedExt = "jpg"; forcedCt = "image/jpeg"; }
      // gif (animación), mp4, pdf y URLs sin extensión → bajada directa, sin tocar.

      const r = await fetch(fetchUrl, { redirect: "follow" });
      if (!r.ok) { console.warn("[rehost] fetch no-ok", r.status, url.slice(0, 120)); return { url, changed: false }; }
      const ct = forcedCt || r.headers.get("content-type") || "";
      if (!isMediaContentType(ct)) { console.warn("[rehost] content-type no media:", ct, url.slice(0, 120)); return { url, changed: false }; }
      const buf = new Uint8Array(await r.arrayBuffer());
      if (buf.byteLength === 0 || buf.byteLength > MAX_BYTES) { console.warn("[rehost] tamaño fuera de rango", buf.byteLength); return { url, changed: false }; }
      const ext = forcedExt || extFromContentType(ct, url);
      const hash = await sha16(url);
      const path = `${org}/${prod || "shared"}/rehosted/${hash}.${ext}`;
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, buf, {
        upsert: true,
        contentType: forcedCt || (ct.split(";")[0] || "application/octet-stream"),
      });
      if (upErr) { console.error("[rehost] upload error", upErr.message); return { url, changed: false }; }
      const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
      return { url: pub.publicUrl, changed: true };
    } catch (e) {
      console.error("[rehost] exception", String(e), url.slice(0, 120));
      return { url, changed: false };
    }
  };

  let itemsChanged = 0;
  let mediaRehosted = 0;
  let mediaReoptimized = 0;

  for (const it of items) {
    const org = it.organization_id;
    const prod = it.product_id ?? null;
    let changed = false;

    // images[]
    const images: string[] = Array.isArray(it.images) ? it.images : [];
    const newImages: string[] = [];
    for (const u of images) {
      const res = await rehostUrl(u, org, prod);
      newImages.push(res.url);
      if (res.changed) { changed = true; mediaRehosted++; }
    }

    // thumbnail_url (si coincide con una imagen ya rehospedada, reusar el mapeo)
    let newThumb = it.thumbnail_url;
    if (isHttp(it.thumbnail_url)) {
      const idx = images.indexOf(it.thumbnail_url);
      if (idx >= 0) {
        newThumb = newImages[idx];
        if (newThumb !== it.thumbnail_url) changed = true;
      } else {
        const res = await rehostUrl(it.thumbnail_url, org, prod);
        newThumb = res.url;
        if (res.changed) { changed = true; mediaRehosted++; }
      }
    }

    // videos[]
    const videos: string[] = Array.isArray(it.videos) ? it.videos : [];
    const newVideos: string[] = [];
    for (const u of videos) {
      const res = await rehostUrl(u, org, prod);
      newVideos.push(res.url);
      if (res.changed) { changed = true; mediaRehosted++; }
    }

    // documents[] (objetos { url, name, type })
    const docs: any[] = Array.isArray(it.documents) ? it.documents : [];
    const newDocs: any[] = [];
    for (const d of docs) {
      if (d && isHttp(d.url)) {
        const res = await rehostUrl(d.url, org, prod);
        newDocs.push({ ...d, url: res.url });
        if (res.changed) { changed = true; mediaRehosted++; }
      } else newDocs.push(d);
    }

    if (changed) {
      const { error: updErr } = await supabase.from("product_catalog_items").update({
        images: newImages,
        thumbnail_url: newThumb,
        videos: newVideos,
        documents: newDocs,
      }).eq("id", it.id);
      if (updErr) console.error("[rehost] update item error", it.id, updErr.message);
      else itemsChanged++;
    }
  }

  return json({ ok: true, items_seen: items.length, items_changed: itemsChanged, media_rehosted: mediaRehosted, media_reoptimized: mediaReoptimized });
});
