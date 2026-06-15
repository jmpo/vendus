---
name: Regional Format Paraguay v1
description: Frontend de display fija formato regional Paraguay (es-PY / PYG / DDI 595). Helper centralizado en src/lib/regional.ts. Backend/DDI outbound siguen siendo 55 (no se tocan edge functions).
type: feature
---
Fase 7 (parcial): solo Paraguay activo. AR/MX/UY/BR pendientes.

- Helper: `src/lib/regional.ts` exporta `formatCurrency`, `formatCurrencyCompact`, `formatNumber`, `formatDate`, `formatDateTime`, `normalizePhonePY`, `formatPhonePY`, y constante `REGION` (`es-PY` / `PYG` / `+595` / `🇵🇾`).
- Reemplazo masivo en `src/components`, `src/hooks`, `src/pages`, `src/config`: `'pt-BR'` → `'es-PY'`, `currency: 'BRL'` → `currency: 'PYG'`, `'R$ '` → `'₲ '`.
- `ChatPhoneInput`: país default = Paraguay (`+595`), placeholder `981 234 567`, formatter `9XX XXX XXX`.
- NO se modificaron edge functions ni constraints de backend. La memoria `Phone DDI Constraint` (DDI 55 outbound) sigue válida en backend hasta que el usuario pida ampliar.
- Para extender a otro país: agregar nueva constante `REGION_XX` y permitir override via settings de la organización.
