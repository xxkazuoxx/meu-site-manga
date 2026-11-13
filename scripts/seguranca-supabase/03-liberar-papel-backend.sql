-- Luz Entre Sombras — LIBERAR UM PAPEL DE BACKEND específico sob RLS.
--
-- Use SOMENTE se 01-diagnostico.sql mostrar que o backend do Render conecta com
-- um papel que NÃO é dono das tabelas e NÃO tem BYPASSRLS. Rode ANTES de
-- 02-aplicar-protecao.sql (políticas em tabelas sem RLS ficam inativas, então
-- não há interrupção) — ou depois, como recuperação, se o site parar de ler/gravar.
--
-- Antes de executar: troque o valor de v_role abaixo pelo NOME do papel
-- (só o nome de usuário do DATABASE_URL, nunca a senha). Recusa papéis públicos.
-- NÃO EXECUTADO NO SUPABASE. Testado localmente em tests/seguranca-supabase.test.js.
BEGIN;
-- Não enfileirar o site: ALTER TABLE ... ROW LEVEL SECURITY exige bloqueio
-- AccessExclusive. Se alguma consulta segurar a tabela, desiste em 5 s
-- (erro "lock timeout", nada é alterado) em vez de travar as leituras do site.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
DECLARE
  v_role constant text := 'TROCAR_PELO_PAPEL_DO_BACKEND';
  v_tables constant text[] := ARRAY['mangas', 'chapters', 'pages', 'comments', 'schema_migrations',
    'pages_backup_cloudinary_before_public_id'];
  v_table text;
  v_oid regclass;
BEGIN
  IF v_role = 'TROCAR_PELO_PAPEL_DO_BACKEND' THEN
    RAISE EXCEPTION 'Defina v_role com o nome do papel do backend. Nada foi alterado.';
  END IF;
  IF v_role IN ('anon', 'authenticated', 'public', 'PUBLIC') THEN
    RAISE EXCEPTION 'Recusado: % é um papel público. Nada foi alterado.', v_role;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
    RAISE EXCEPTION 'Papel % não existe. Nada foi alterado.', v_role;
  END IF;
  FOREACH v_table IN ARRAY v_tables LOOP
    v_oid := to_regclass(format('public.%I', v_table));
    CONTINUE WHEN v_oid IS NULL;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = v_table
                   AND policyname = 'les_backend_acesso_total') THEN
      EXECUTE format('CREATE POLICY les_backend_acesso_total ON public.%I FOR ALL TO %I USING (true) WITH CHECK (true)', v_table, v_role);
    ELSIF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = v_table
                      AND policyname = 'les_backend_acesso_total' AND v_role = ANY(roles)) THEN
      RAISE EXCEPTION 'A política les_backend_acesso_total já existe em public.% para outro papel. Nada foi alterado.', v_table;
    END IF;
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO %I', v_table, v_role);
  END LOOP;
  EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO %I', v_role);
END $$;

COMMIT;
