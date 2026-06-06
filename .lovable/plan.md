## Contexto

Parceiros que estão clonando (remix) a plataforma e abrindo no próprio projeto Lovable estão vendo conteúdo da Vendus vazando: domínio `app.vendus.com.br` em links, planos hardcoded (Trial/Starter/Pro/Enterprise) no dashboard, erro ao criar usuário, chamados de suporte que somem e cores que só aparecem na área logada. O objetivo é deixar tudo dinâmico/multi-tenant para que ao fazer download → subir no Lovable → conectar o backend, a plataforma já funcione com a marca e os dados do parceiro.

## O que vamos corrigir

### 1. Domínio vazando para o parceiro
Hoje 18+ componentes usam `'https://app.vendus.com.br'` como **valor padrão** do `useQuery` (`useQuery({ initialData: 'https://app.vendus.com.br' })`) e `src/lib/publicUrl.ts` tem `DEFAULT_PUBLIC_APP_URL = 'https://app.vendus.com.br'` + `FALLBACK = 'https://sales-guide-buddy-11.lovable.app'`. Resultado: enquanto a request resolve (ou em projetos sem `public_app_url` cadastrado), aparece o domínio da Vendus em links de booking, widget, formulários, etc.

Fix:
- Em `src/lib/publicUrl.ts` remover defaults Vendus. Cascata nova: `public_app_url` do banco → `window.location.origin` (sempre que disponível, mesmo em editor) → `''` (não renderiza link quebrado).
- Atualizar todos os componentes que fazem `useQuery({ ... }) = 'https://app.vendus.com.br'` para usar o valor do hook sem fallback Vendus.
- Painel Super Admin (Identidade Visual → Marca) já tem o campo "URL pública da plataforma". Vamos só adicionar um banner/aviso explicando que esse campo é obrigatório antes de publicar.

### 2. Planos hardcoded no dashboard Super Admin
`src/components/superadmin/SuperAdminDashboard.tsx` renderiza 4 cards fixos (Trial, Starter, Pro, Enterprise) e `useSuperAdmin.ts` agrega por `plan_type` (coluna que nem existe em `platform_plans`). No banco do parceiro só existem os planos que ele cadastrou.

Fix:
- Reescrever a query de stats para juntar `organizations.plan_id` com `platform_plans` e devolver `[{ plan_id, name, slug, color, count }]`.
- O componente do dashboard passa a iterar sobre o array real — sem nomes hardcoded. Cor do bullet vem de um campo `color` opcional do plano (ou hash do slug como fallback).

### 3. Erro ao criar usuário (Edge Function returned a non-2xx)
Investigamos a edge function `create-team-member` (não há logs porque o erro acontece dentro do try). Causa provável no remix: a função chama `admin.from('user_roles').delete().eq('user_id', newUserId)` e depois `.insert(...)` sem verificar erro — e na sequência roda `initialize_user_permissions`. Se qualquer um dos passos retornar erro silencioso (ex: enum `app_role` sem o valor passado, tabela `user_notification_settings` faltando no projeto do parceiro), o cliente recebe 500 sem detalhes.

Fix:
- Em `create-team-member/index.ts`: capturar erro de cada passo (`profiles update`, `user_roles delete/insert`, `initialize_user_permissions`, `sector_members`) e devolver no body um JSON `{ step, message }` para diagnóstico real.
- Garantir idempotência: se o trigger `handle_new_user` já inseriu role `seller`, o `delete + insert` vira `upsert`.
- Logar `console.error` com contexto em cada catch para aparecer nos logs.
- Validar que o enum `app_role` tem `admin/manager/seller` antes do insert (e devolver erro amigável se não tiver).

### 4. Suporte: chamados não aparecem na tela
Tabelas e RLS estão corretas; o problema é que na área Super Admin do remix o usuário criado pelo dono **não tem role `super_admin`** atribuída — então a policy `is_super_admin(auth.uid())` bloqueia a leitura, e o "0 chamados" aparece em ambos os lados. Também não há indicador visual quando o INSERT da mensagem falha por RLS (`author_id = auth.uid()` ok, mas se `is_super_admin` retorna false e ele não pertence à org do ticket, a mensagem é negada).

Fix:
- Confirmar que o fluxo "Primeiro Acesso Super Admin" (`FirstAccessSuperAdminModal`) realmente cria a role `super_admin` no `user_roles` para o e-mail que assumir o painel. Adicionar verificação visível: se o usuário entrou em `/super-admin` mas não tem role, mostra banner "Sua conta ainda não foi promovida a Super Admin" com botão "Promover agora" (chama RPC `promote_to_super_admin` — vamos criar).
- Em `useSupportTickets.ts`/`SupportTickets.tsx`: tratar erro 0-rows vs erro de permissão e mostrar mensagem clara.
- Verificar realtime: garantir que `support_tickets` e `support_messages` estão em `supabase_realtime` publication.

### 5. Cores não aplicam fora da área logada
A view `platform_branding_public` só tem `SELECT` para o role `sandbox_exec` — não para `anon` nem `authenticated`. Por isso a leitura por usuário não logado (login, booking público, formulários, quiz, widget) volta null e cai no tema padrão hardcoded.

Fix:
- Migração: `GRANT SELECT ON public.platform_branding_public TO anon, authenticated;`
- Garantir que páginas públicas (`PublicBooking`, `PublicQuiz`, `AcceptInvite`, `ResetPassword`, `Auth`) estão dentro do provider que dispara `usePlatformBranding()` em `App.tsx` (já estão — só faltava o GRANT).
- Bonus: aplicar `--primary` inline no HTML inicial via `<script>` lendo `localStorage` para evitar flash da cor padrão antes do React montar (já temos cache no `usePlatformBranding`).

### 6. Pensando no parceiro fazendo backup/download
- Todas as alterações de schema acima viram migration única e idempotente (`IF NOT EXISTS`, `CREATE POLICY IF NOT EXISTS`), incluindo o GRANT do view, criação da RPC `promote_to_super_admin`, e os seeds dos enums.
- Documentar em `REMIX.md` os 4 passos pós-clone: (1) ativar Cloud, (2) rodar migrations, (3) preencher "URL pública da plataforma" + dados de marca, (4) entrar em `/super-admin` e clicar em "Promover-me a Super Admin".

## Arquivos afetados

- `src/lib/publicUrl.ts`
- ~18 componentes que usam `usePublicAppUrl` com fallback Vendus (booking, forms, quiz, widget, chat, snippets)
- `src/hooks/useSuperAdmin.ts` + `src/components/superadmin/SuperAdminDashboard.tsx`
- `supabase/functions/create-team-member/index.ts`
- `src/hooks/useSupportTickets.ts` + `src/components/admin/support/SupportTickets.tsx` + `FirstAccessSuperAdminModal`
- 1 migration SQL (GRANT do view + RPC `promote_to_super_admin` + ajuste de realtime publication)
- `REMIX.md`

## O que NÃO entra

- Reescrever sistema de planos/cobrança — só tornar o dashboard dinâmico.
- Mexer no fluxo de auth/email (`auth-email-hook` tem "vendus" hardcoded mas é usado só pelo nosso projeto, no parceiro o trigger não vai chamar essa função).
- Trocar/refatorar o engine de white-label (já está bom, só faltam o GRANT e remover fallbacks Vendus).
