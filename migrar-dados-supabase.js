import 'dotenv/config'
import Database from 'better-sqlite3'
import pg from 'pg'

const { Client } = pg

const sqlite = new Database('data/manga.db', { readonly: true })

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
})

try {
  await client.connect()

  const mangas = sqlite.prepare('SELECT * FROM mangas ORDER BY id').all()
  const chapters = sqlite.prepare('SELECT * FROM chapters ORDER BY id').all()
  const pages = sqlite.prepare('SELECT * FROM pages ORDER BY id').all()
  const comments = sqlite.prepare('SELECT * FROM comments ORDER BY id').all()

  console.log('===== DADOS ENCONTRADOS NO SQLITE =====')
  console.log(`Mangás: ${mangas.length}`)
  console.log(`Capítulos: ${chapters.length}`)
  console.log(`Páginas: ${pages.length}`)
  console.log(`Comentários: ${comments.length}`)

  await client.query('BEGIN')

  for (const manga of mangas) {
    await client.query(
      `
      INSERT INTO mangas
        (id, title, volume, description, cover, slug)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (id) DO NOTHING
      `,
      [
        manga.id,
        manga.title,
        manga.volume,
        manga.description,
        manga.cover,
        manga.slug,
      ]
    )
  }

  for (const chapter of chapters) {
    await client.query(
      `
      INSERT INTO chapters
        (id, manga_id, number, title, slug, reader_url)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (id) DO NOTHING
      `,
      [
        chapter.id,
        chapter.manga_id,
        chapter.number,
        chapter.title,
        chapter.slug,
        chapter.reader_url,
      ]
    )
  }

  for (const page of pages) {
    await client.query(
      `
      INSERT INTO pages
        (id, chapter_id, page_number, url)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (id) DO NOTHING
      `,
      [
        page.id,
        page.chapter_id,
        page.page_number,
        page.url,
      ]
    )
  }

  for (const comment of comments) {
    await client.query(
      `
      INSERT INTO comments
        (id, manga_id, chapter_slug, parent_id,
         author_name, content, status, created_at, updated_at)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (id) DO NOTHING
      `,
      [
        comment.id,
        comment.manga_id,
        comment.chapter_slug,
        comment.parent_id,
        comment.author_name,
        comment.content,
        comment.status,
        comment.created_at,
        comment.updated_at,
      ]
    )
  }

  await client.query('COMMIT')

  console.log('')
  console.log('===== MIGRAÇÃO =====')
  console.log('DADOS COPIADOS COM SUCESSO PARA O SUPABASE.')
} catch (error) {
  await client.query('ROLLBACK').catch(() => {})
  console.error('MIGRAÇÃO FALHOU:')
  console.error(error.message)
  process.exitCode = 1
} finally {
  sqlite.close()
  await client.end().catch(() => {})
}
