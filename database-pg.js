import 'dotenv/config'
import pg from 'pg'

const { Pool } = pg

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL não está configurada.')
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
})

export async function query(text, values = []) {
  return pool.query(text, values)
}

export async function closeDatabase() {
  await pool.end()
}

export default pool
