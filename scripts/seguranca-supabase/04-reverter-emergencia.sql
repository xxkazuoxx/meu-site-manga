-- Luz Entre Sombras — REVERSÃO DE EMERGÊNCIA da proteção (02-aplicar-protecao.sql).
--
-- ATENÇÃO: volta ao estado INSEGURO anterior (RLS desligado e privilégios totais
-- para anon/authenticated nas 6 tabelas). Use só se o site parar de funcionar
-- após a proteção E a recuperação direcionada (03-liberar-papel-backend.sql)
-- não for possível. Depois, investigue e reaplique a proteção o quanto antes.
--
-- Não concede EXECUTE em funções: as funções das migrações devem continuar
-- restritas ao service_role mesmo numa emergência.
-- NÃO EXECUTADO NO SUPABASE. Testado localmente em tests/seguranca-supabase.test.js.
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
BEGIN
  FOREACH v_table IN ARRAY v_tables LOOP
    CONTINUE WHEN to_regclass(format('public.%I', v_table)) IS NULL;
    EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', v_table);
    EXECUTE format('GRANT ALL PRIVILEGES ON TABLE public.%I TO anon, authenticated', v_table);
  END LOOP;
END $$;

GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated;

COMMIT;
