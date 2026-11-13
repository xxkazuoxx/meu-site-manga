-- Luz Entre Sombras — DIAGNÓSTICO de segurança do Supabase (SOMENTE LEITURA).
-- Um único SELECT sobre o catálogo e pg_stat_activity. Não lê linhas das
-- tabelas do site, não altera nada, não mostra IPs, senhas ou chaves.
-- Rodar no SQL Editor ANTES e DEPOIS de 02-aplicar-protecao.sql e comparar.
-- Verificado por tests/seguranca-supabase.test.js.
SELECT jsonb_pretty(jsonb_build_object(
  'gerado_em', now(),
  'papel_atual', current_user,
  -- Quem é dono de cada tabela (o dono não é afetado pelo RLS sem FORCE).
  'tabelas', (
    SELECT jsonb_agg(jsonb_build_object('tabela', c.relname, 'dono', pg_get_userbyid(c.relowner),
      'rls', c.relrowsecurity, 'rls_forcado', c.relforcerowsecurity) ORDER BY c.relname)
    FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')),
  -- Atributos dos papéis que podem acessar o banco (sem senhas).
  'papeis', (
    SELECT jsonb_agg(jsonb_build_object('papel', rolname, 'login', rolcanlogin, 'superusuario', rolsuper,
      'bypassrls', rolbypassrls, 'herda', rolinherit) ORDER BY rolname)
    FROM pg_roles WHERE rolcanlogin OR rolname IN ('anon', 'authenticated', 'service_role')),
  -- As 6 tabelas do site que NÃO existem (esperado: vazio).
  'tabelas_esperadas_ausentes', (
    SELECT jsonb_agg(t ORDER BY t) FROM unnest(ARRAY['mangas', 'chapters', 'pages', 'comments', 'schema_migrations',
      'pages_backup_cloudinary_before_public_id']) AS t WHERE to_regclass(format('public.%I', t)) IS NULL),
  -- Para cada papel de login (e service_role): ele ignora o RLS nas 6 tabelas?
  -- (superusuário, BYPASSRLS ou dono direto de todas). E o que pode fazer nelas.
  -- É o que decide se o backend do Render continua funcionando após 02-aplicar-protecao.sql.
  'acesso_dos_papeis_de_login', (
    SELECT jsonb_agg(jsonb_build_object(
      'papel', r.rolname,
      'ignora_rls', r.rolsuper OR r.rolbypassrls OR NOT EXISTS (
        SELECT 1 FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
          AND c.relname IN ('mangas', 'chapters', 'pages', 'comments', 'schema_migrations', 'pages_backup_cloudinary_before_public_id')
          AND c.relowner <> r.oid),
      'motivo', CASE WHEN r.rolsuper THEN 'superusuario' WHEN r.rolbypassrls THEN 'bypassrls'
        WHEN NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
          AND c.relname IN ('mangas', 'chapters', 'pages', 'comments', 'schema_migrations', 'pages_backup_cloudinary_before_public_id')
          AND c.relowner <> r.oid) THEN 'dono_das_tabelas' ELSE 'nao_ignora' END,
      'privilegios', (
        SELECT jsonb_object_agg(c.relname, (SELECT coalesce(jsonb_agg(priv ORDER BY priv), '[]'::jsonb)
          FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) AS priv WHERE has_table_privilege(r.oid, c.oid, priv)))
        FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
          AND c.relname IN ('mangas', 'chapters', 'pages', 'comments', 'schema_migrations', 'pages_backup_cloudinary_before_public_id')))
      ORDER BY r.rolname)
    FROM pg_roles r WHERE r.rolcanlogin OR r.rolname = 'service_role'),
  -- Papéis dos quais anon/authenticated herdam privilégios (herança indireta).
  'heranca_publica', (
    SELECT jsonb_agg(jsonb_build_object('papel', r.rolname, 'membro_de', g.rolname) ORDER BY r.rolname, g.rolname)
    FROM pg_auth_members a JOIN pg_roles r ON r.oid = a.member JOIN pg_roles g ON g.oid = a.roleid
    WHERE r.rolname IN ('anon', 'authenticated')),
  -- Usuários conectados agora (identifica o papel efetivo do backend do Render; sem IPs).
  'conexoes_por_usuario', (
    SELECT jsonb_agg(jsonb_build_object('usuario', usename, 'aplicacao', application_name, 'conexoes', total) ORDER BY usename)
    FROM (SELECT usename, application_name, count(*) AS total FROM pg_stat_activity
          WHERE datname = current_database() AND backend_type = 'client backend' GROUP BY 1, 2) AS ativos),
  -- Privilégios EFETIVOS (inclui herança e PUBLIC) dos papéis públicos nas tabelas.
  'privilegios_publicos_tabelas', (
    SELECT jsonb_agg(jsonb_build_object('tabela', c.relname, 'papel', p.papel, 'privilegios', (
      SELECT jsonb_agg(priv ORDER BY priv) FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) AS priv
      WHERE has_table_privilege(p.papel, c.oid, priv))) ORDER BY c.relname, p.papel)
    FROM pg_class c CROSS JOIN (VALUES ('anon'), ('authenticated'), ('public')) AS p(papel)
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')),
  'privilegios_publicos_sequencias', (
    SELECT jsonb_agg(jsonb_build_object('sequencia', c.relname, 'papel', p.papel, 'privilegios', (
      SELECT jsonb_agg(priv ORDER BY priv) FROM unnest(ARRAY['USAGE', 'SELECT', 'UPDATE']) AS priv
      WHERE has_sequence_privilege(p.papel, c.oid, priv))) ORDER BY c.relname, p.papel)
    FROM pg_class c CROSS JOIN (VALUES ('anon'), ('authenticated'), ('public')) AS p(papel)
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'S'),
  'funcoes_executaveis_por_publicos', (
    SELECT jsonb_agg(jsonb_build_object('funcao', f.proname, 'papel', p.papel) ORDER BY f.proname, p.papel)
    FROM pg_proc f CROSS JOIN (VALUES ('anon'), ('authenticated'), ('public')) AS p(papel)
    WHERE f.pronamespace = 'public'::regnamespace AND has_function_privilege(p.papel, f.oid, 'EXECUTE')),
  -- Privilégios padrão concedidos a objetos FUTUROS (PUBLIC aparece como "PUBLIC").
  'privilegios_padrao_publicos', (
    SELECT jsonb_agg(jsonb_build_object('dono', pg_get_userbyid(d.defaclrole), 'tipo', d.defaclobjtype,
      'para', CASE WHEN e.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END, 'privilegio', e.privilege_type)
      ORDER BY 1)
    FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) e
    WHERE (d.defaclnamespace = 0 OR d.defaclnamespace = 'public'::regnamespace)
      AND (e.grantee = 0 OR pg_get_userbyid(e.grantee) IN ('anon', 'authenticated'))),
  'politicas_rls', (
    SELECT jsonb_agg(jsonb_build_object('tabela', tablename, 'nome', policyname, 'comando', cmd, 'papeis', roles) ORDER BY tablename, policyname)
    FROM pg_policies WHERE schemaname = 'public'),
  -- Resumo: true quando nenhum papel público consegue ler ou gravar em tabela alguma.
  'protegido', NOT EXISTS (
    SELECT 1 FROM pg_class c CROSS JOIN (VALUES ('anon'), ('authenticated'), ('public')) AS p(papel)
      CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) AS priv
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p') AND has_table_privilege(p.papel, c.oid, priv))
    AND NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity)
)) AS diagnostico;
