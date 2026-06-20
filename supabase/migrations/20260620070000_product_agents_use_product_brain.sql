-- Flag de uso del cerebro del producto por agente. El agente lo lee para inyectar
-- el conocimiento del producto; faltaba (migración Lovable) → nunca cargaba el cerebro.
ALTER TABLE public.product_agents
  ADD COLUMN IF NOT EXISTS use_product_brain boolean NOT NULL DEFAULT true;
