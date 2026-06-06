-- Backfill cakto_offer_slug a partir do raw_payload (Cakto envia em camelCase `checkoutUrl`)
UPDATE public.cakto_orders
SET cakto_offer_slug = regexp_replace(
  COALESCE(
    raw_payload->>'checkoutUrl',
    raw_payload->>'checkout_url',
    raw_payload->'order'->>'checkoutUrl',
    raw_payload->'data'->'order'->>'checkoutUrl'
  ),
  '^.*/([^/?#]+)(?:[?#].*)?$', '\1'
)
WHERE cakto_offer_slug IS NULL
  AND COALESCE(
    raw_payload->>'checkoutUrl',
    raw_payload->>'checkout_url',
    raw_payload->'order'->>'checkoutUrl',
    raw_payload->'data'->'order'->>'checkoutUrl'
  ) IS NOT NULL;