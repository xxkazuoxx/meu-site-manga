-- Luz Entre Sombras — QUAL PAPEL o backend do Render usa de fato (SOMENTE LEITURA).
--
-- Usa a extensão pg_stat_statements (já instalada no projeto), que registra o
-- papel que executou cada consulta. Procura as consultas características do
-- Express (server.js) e devolve só NOMES DE PAPÉIS e CONTAGENS — nunca o texto
-- das consultas (que poderia conter dados digitados no SQL Editor).
-- Um único SELECT; não altera nada. Rodar no SQL Editor depois de usar o site
-- publicado (abrir a página inicial e um capítulo).
-- Verificado por tests/seguranca-supabase.test.js (com uma visão simulada).
SELECT jsonb_pretty(jsonb_build_object(
  'gerado_em', now(),
  'estatisticas_desde', (SELECT stats_reset FROM pg_stat_statements_info),
  -- Consultas que só o Express faz (textos de server.js), por papel executor.
  'consultas_do_express_por_papel', (
    SELECT jsonb_agg(jsonb_build_object('papel', papel, 'padrao', padrao, 'consultas', total, 'execucoes', execucoes)
      ORDER BY padrao, papel)
    FROM (
      SELECT r.rolname AS papel, p.padrao, count(*) AS total, sum(s.calls) AS execucoes
      FROM pg_stat_statements s
      JOIN pg_roles r ON r.oid = s.userid
      JOIN (VALUES
        ('catalogo_mangas', 'select id, title, volume, description, cover, slug from mangas order by id'),
        ('capitulos_do_manga', 'select id, number, title, slug, reader_url from chapters where manga_id = $1 order by number'),
        ('paginas_do_capitulo', 'select id, page_number, url from pages where chapter_id = $1 order by page_number'),
        ('comentarios_ordenados', 'order by created_at asc, id asc'),
        ('novo_comentario', 'insert into comments ( manga_id, chapter_slug, parent_id, author_name, content )')
      ) AS p(padrao, texto) ON position(p.texto IN lower(regexp_replace(s.query, '\s+', ' ', 'g'))) > 0
      GROUP BY r.rolname, p.padrao) AS achados),
  -- Visão geral: que papéis executaram consultas citando as tabelas do site.
  'papeis_que_usaram_as_tabelas', (
    SELECT jsonb_agg(jsonb_build_object('papel', papel, 'consultas', total, 'execucoes', execucoes) ORDER BY papel)
    FROM (
      SELECT r.rolname AS papel, count(*) AS total, sum(s.calls) AS execucoes
      FROM pg_stat_statements s JOIN pg_roles r ON r.oid = s.userid
      WHERE lower(s.query) ~ '\m(mangas|chapters|pages|comments|schema_migrations|pages_backup_cloudinary_before_public_id)\M'
      GROUP BY r.rolname) AS uso)
)) AS papel_do_render;
