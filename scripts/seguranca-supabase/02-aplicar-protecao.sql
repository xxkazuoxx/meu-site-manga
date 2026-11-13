-- Luz Entre Sombras — PROTEÇÃO do Supabase: RLS + revogação de privilégios públicos.
--
-- PREPARADO E TESTADO LOCALMENTE EM 13/11/2026. NÃO EXECUTADO NO SUPABASE.
-- Executar somente com autorização explícita, depois de:
--   1. backup do projeto;
--   2. 01-diagnostico.sql (confirmar o papel do backend do Render);
--   3. se o backend NÃO for dono das tabelas nem tiver BYPASSRLS:
--      03-liberar-papel-backend.sql ANTES deste arquivo.
-- Ver docs/seguranca-supabase-rls.md.
--
-- O que faz (nas tabelas que existirem):
--   * liga o RLS (sem políticas: anon/authenticated não veem nem gravam linhas);
--   * revoga TODOS os privilégios de anon, authenticated e PUBLIC nas tabelas
--     (SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN),
--     em todas as sequências e o EXECUTE em funções do esquema public;
--   * para objetos FUTUROS criados pelo papel atual, deixa de conceder
--     automaticamente privilégios a anon/authenticated/PUBLIC.
-- O que NÃO faz: não apaga, não altera nem lê dados; não mexe em service_role
-- (backend do Cloudflare) nem no dono das tabelas (que não é afetado pelo RLS).
--
-- Tudo numa transação: se qualquer verificação falhar, nada é alterado.
-- Idempotente: pode ser executado de novo sem efeito adicional.
BEGIN;
-- Não enfileirar o site: ALTER TABLE ... ROW LEVEL SECURITY exige bloqueio
-- AccessExclusive. Se alguma consulta segurar a tabela, desiste em 5 s
-- (erro "lock timeout", nada é alterado) em vez de travar as leituras do site.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
DECLARE
  v_tables constant text[] := ARRAY['mangas', 'chapters', 'pages', 'comments', 'schema_migrations',
    'pages_backup_cloudinary_before_public_id'];
  v_table text;
  v_oid regclass;
BEGIN
  -- Trava 1: o backend do Cloudflare usa service_role, que precisa ignorar o RLS.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role' AND rolbypassrls) THEN
    RAISE EXCEPTION 'service_role ausente ou sem BYPASSRLS: o backend do Cloudflare deixaria de funcionar. Nada foi alterado.';
  END IF;
  -- Trava 2: nunca executar como papel público.
  IF current_user IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'Execute como o dono das tabelas (no Supabase: postgres), não como %.', current_user;
  END IF;

  FOREACH v_table IN ARRAY v_tables LOOP
    v_oid := to_regclass(format('public.%I', v_table));
    IF v_oid IS NULL THEN
      RAISE NOTICE 'Tabela public.% não existe; ignorada.', v_table;
      CONTINUE;
    END IF;
    -- Trava 3: só o dono (ou membro do papel dono) pode ligar o RLS.
    IF NOT pg_has_role(current_user, (SELECT relowner FROM pg_class WHERE oid = v_oid), 'USAGE') THEN
      RAISE EXCEPTION 'O papel % não é dono de public.%. Nada foi alterado.', current_user, v_table;
    END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM anon, authenticated, PUBLIC', v_table);
  END LOOP;
END $$;

-- Sequências (impede nextval/setval por papéis públicos) e funções do esquema public.
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated, PUBLIC;

-- Objetos futuros criados pelo papel atual não recebem mais privilégios públicos automaticamente.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated, PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated, PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated, PUBLIC;

-- Autoverificação: se ainda houver qualquer acesso público efetivo (inclusive
-- herdado), a transação inteira é desfeita.
DO $$
DECLARE
  v_problem text;
BEGIN
  SELECT format('%s ainda tem %s em public.%s', p.papel, priv, c.relname) INTO v_problem
  FROM pg_class c CROSS JOIN (VALUES ('anon'), ('authenticated'), ('public')) AS p(papel)
    CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) AS priv
  WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p') AND has_table_privilege(p.papel, c.oid, priv)
  LIMIT 1;
  IF v_problem IS NOT NULL THEN
    RAISE EXCEPTION 'Autoverificação falhou (%). Provável privilégio herdado ou tabela fora da lista. Nada foi alterado.', v_problem;
  END IF;
  SELECT format('RLS desligado em public.%s', relname) INTO v_problem FROM pg_class
  WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r', 'p') AND NOT relrowsecurity LIMIT 1;
  IF v_problem IS NOT NULL THEN
    RAISE EXCEPTION 'Autoverificação falhou (%). Nada foi alterado.', v_problem;
  END IF;
END $$;

COMMIT;
