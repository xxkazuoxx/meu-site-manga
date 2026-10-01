import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { migrateCommentSchema } from './migrations/comments.js'

const databasePath = path.resolve(
  process.cwd(),
  process.env.DATABASE_PATH || 'data/manga.db'
)

fs.mkdirSync(path.dirname(databasePath), { recursive: true })

const db = new Database(databasePath)

db.pragma('foreign_keys = ON')

db.exec(`
  CREATE TABLE IF NOT EXISTS mangas (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    volume TEXT,
    description TEXT,
    cover TEXT,
    slug TEXT NOT NULL UNIQUE
  );

  CREATE TABLE IF NOT EXISTS chapters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    manga_id TEXT NOT NULL,
    number INTEGER NOT NULL,
    title TEXT NOT NULL,
    slug TEXT NOT NULL,
    reader_url TEXT NOT NULL,
    UNIQUE (manga_id, slug),
    FOREIGN KEY (manga_id)
      REFERENCES mangas(id)
      ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS pages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chapter_id INTEGER NOT NULL,
    page_number INTEGER NOT NULL,
    url TEXT NOT NULL UNIQUE,
    UNIQUE (chapter_id, page_number),
    FOREIGN KEY (chapter_id)
      REFERENCES chapters(id)
      ON DELETE CASCADE
  );
`)

migrateCommentSchema(db)

export default db
