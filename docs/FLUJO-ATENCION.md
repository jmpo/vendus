# Flujo de atención — Vendus (Automaq)

Cómo viaja un mensaje desde que el cliente escribe hasta que el agente responde, y **dónde aparece la fricción**.

## Diagrama del proceso

```mermaid
flowchart TD
  A([Cliente escribe por WhatsApp]) --> B[Evolution Go]
  B --> C[evolution-webhook]
  C --> D[Agrupa mensajes seguidos<br/>debounce / dedup]
  D --> E[[webchat-bot · cerebro]]

  E --> F{¿status de la conversación?}
  F -->|waiting_human| G[/IA NO responde<br/>espera atención humana/]:::warn
  F -->|bot_active| H{¿primer mensaje<br/>de la charla?}

  H -->|sí| I[Saludo de bienvenida]:::ok
  H -->|no| J{¿orquestación activa<br/>y en 'triagem'?}

  J -->|sí| K[ORQUESTADOR<br/>clasifica vehículo + intención]
  K --> L{¿detectó producto<br/>y confianza ≥ 0.45?}
  L -->|sí| M[Rutea al CLOSER del vehículo]:::ok
  L -->|no / vago| N[Hace 1 pregunta de aclaración]
  L -->|pidió humano| O[Handoff → atención humana]

  J -->|ya en 'em_atendimento'| P
  M --> P[[CLOSER del vehículo<br/>Citroën / Peugeot]]

  P --> Q{¿el cliente cambió<br/>a otro vehículo?}
  Q -->|sí, confianza ≥ 0.75| R[Re-rutea al otro Closer]:::warn
  Q -->|no| S[Closer responde]

  R --> S
  S --> T[Usa herramientas:<br/>search_catalog · send_catalog_item<br/>check_available_slots · schedule_meeting]
  T --> U([evolution-send → WhatsApp])

  classDef ok fill:#0b3d2e,stroke:#22c55e,color:#fff;
  classDef warn fill:#3d2e0b,stroke:#f59e0b,color:#fff;
```

## Puntos de fricción detectados (estado al 17/6/2026)

| # | Síntoma que ve el cliente | Causa raíz | Estado |
|---|---|---|---|
| 1 | La IA no responde | `status = waiting_human` (venía de un handoff). El bot calla a propósito. | ✅ Se reactiva con botón **"Retomar"** o reset |
| 2 | Respuestas raras ("parece que hay un error") | **Historial viejo confuso** (mensajes migrados, errores, duplicados) que el modelo lee y repite | ⚠️ Usar **número nuevo** para tests / limpiar historial |
| 3 | El orquestador no ruteaba | Columna `products.is_active` **no existía** (drift código↔schema) → veía 0 productos | ✅ Corregido |
| 4 | "Voy a buscar las fotos…" y no llegan | Imágenes eran **URLs de citroen.com.py bloqueadas (403)** | ✅ Subir fotos propias al storage (hecho) |
| 5 | Tira horarios inventados ("mañana 10:30") | Prompt con ejemplo fijo + **sin `booking_event_types`** | ✅ Evento "Test Drive" creado + prompt reescrito (pregunta→verifica→confirma) |
| 6 | "No, no representamos Peugeot" (¡sí lo hacen!) | El **re-ruteo cross-producto** no se disparó: el Closer Citroën respondió en vez de derivar al Closer Peugeot | 🔴 **Pendiente** |
| 7 | Disponibilidad no se ve en la pantalla | Bug **visual** de frontend (los datos sí están guardados) | 🟡 Menor, pendiente |

## Estructura de agentes actual

```
Orquestador "Asistente Automaq"  (entrada, clasifica, barato — gpt-4o-mini)
   ├─ Closer Citroën   → info + cierre + test drive (C3, Aircross, Basalt, C4)
   ├─ Closer Peugeot   → info + cierre + test drive (208, 2008, 3008, 5008)
   └─ SDR Automaq      → fallback global
```
