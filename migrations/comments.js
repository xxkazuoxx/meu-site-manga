const COMMENT_SCHEMA_VERSION = 1
const COMMENT_SCHEMA_NAME = 'canonical-comments-v1'

const canonicalColumns = [
  'id',
  'manga_id',
  'chapter_slug',
  'parent_id',
  'author_name',
  'content',
  'status',
  'created_at',
  'updated_at',
]

function quoteIdentifier(identifier) {
  return `"${String(identifier).replaceAll('"', '""')}"`
}

function tableExists(db, name) {
  return Boolean(
    db.prepare(`
      SELECT 1
      FROM sqlite_master
      WHERE type = 'table' AND name = ?
    `).get(name)
  )
}

function hasColumn(columns, name) {
  return columns.some((column) => column.name === name)
}

function getStatuses(db, columns) {
  if (!hasColumn(columns, 'status')) {
    return []
  }

  return db.prepare(`
    SELECT DISTINCT status
    FROM comments
  `).all().map((row) => row.status)
}

function validateStatuses(statuses, allowPending) {
  for (const status of statuses) {
    const normalized = String(status ?? '').trim().toLowerCase()
    const allowed = allowPending
      ? ['pending', 'visible', 'offensive']
      : ['visible', 'offensive']

    if (!allowed.includes(normalized)) {
      throw new Error(
        `Comments migration stopped: unsupported status "${normalized || '(empty)'}".`
      )
    }
  }
}

function isCanonicalSchema(db, columns) {
  if (!canonicalColumns.every((column) => hasColumn(columns, column))) {
    return false
  }

  const byName = new Map(columns.map((column) => [column.name, column]))
  if (
    byName.get('id')?.pk !== 1 ||
    !/INT/i.test(byName.get('id')?.type || '') ||
    ['manga_id', 'author_name', 'content', 'status', 'created_at', 'updated_at']
      .some((name) => !byName.get(name)?.notnull)
  ) {
    return false
  }

  const statusColumn = columns.find((column) => column.name === 'status')
  const defaultStatus = String(statusColumn?.dflt_value ?? '')
    .replace(/^'(.*)'$/, '$1')
    .replace(/^"(.*)"$/, '$1')
    .toLowerCase()

  const hasParentCascade = db
    .pragma('foreign_key_list(comments)')
    .some((foreignKey) =>
      foreignKey.table === 'comments' &&
      foreignKey.from === 'parent_id' &&
      foreignKey.to === 'id' &&
      foreignKey.on_delete.toUpperCase() === 'CASCADE'
    )

  return defaultStatus === 'visible' && hasParentCascade
}

function ensureMigrationTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `)
}

function createCanonicalCommentsTable(db, tableName = 'comments') {
  db.exec(`
    CREATE TABLE ${quoteIdentifier(tableName)} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      manga_id TEXT NOT NULL,
      chapter_slug TEXT,
      parent_id INTEGER,
      author_name TEXT NOT NULL,
      content TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'visible'
        CHECK (status IN ('visible', 'offensive')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (parent_id)
        REFERENCES comments(id)
        ON DELETE CASCADE
    )
  `)
}

function statusExpression(columns) {
  if (!hasColumn(columns, 'status')) {
    return "'visible'"
  }

  const status = quoteIdentifier('status')
  return `CASE lower(trim(CAST(${status} AS TEXT)))
    WHEN 'pending' THEN 'visible'
    WHEN 'visible' THEN 'visible'
    WHEN 'offensive' THEN 'offensive'
  END`
}

function timestampExpression(columns, columnName, fallback) {
  if (!hasColumn(columns, columnName)) {
    return fallback
  }

  const column = quoteIdentifier(columnName)
  return `CASE
    WHEN typeof(${column}) = 'text'
      AND trim(${column}) <> ''
      AND datetime(${column}) IS NOT NULL
    THEN ${column}
    ELSE ${fallback}
  END`
}

function foreignKeyClauses(db, columns) {
  const foreignKeys = db.pragma('foreign_key_list(comments)')
  const grouped = new Map()

  for (const foreignKey of foreignKeys) {
    if (!grouped.has(foreignKey.id)) {
      grouped.set(foreignKey.id, [])
    }
    grouped.get(foreignKey.id).push(foreignKey)
  }

  const clauses = []

  for (const rows of grouped.values()) {
    rows.sort((left, right) => left.seq - right.seq)
    const first = rows[0]
    const columnNames = rows.map((row) => row.from === 'name'
      ? 'author_name'
      : row.from)

    if (columnNames.some((name) => !hasColumn(columns, name) && name !== 'author_name')) {
      throw new Error(
        'Comments migration stopped: a foreign key uses an unsupported column.'
      )
    }

    const referenceNames = rows.map((row) => row.to === 'name'
      ? 'author_name'
      : row.to)
    const action = (value) => {
      const normalized = String(value || 'NO ACTION').toUpperCase()
      const allowed = [
        'NO ACTION',
        'RESTRICT',
        'CASCADE',
        'SET NULL',
        'SET DEFAULT',
      ]
      if (!allowed.includes(normalized)) {
        throw new Error(
          'Comments migration stopped: an unsupported foreign-key action was found.'
        )
      }
      return normalized
    }

    const source = columnNames.map(quoteIdentifier).join(', ')
    const target = referenceNames.every(Boolean)
      ? ` (${referenceNames.map(quoteIdentifier).join(', ')})`
      : ''
    const match = String(first.match || 'NONE').toUpperCase()

    if (!['NONE', 'SIMPLE', 'FULL', 'PARTIAL'].includes(match)) {
      throw new Error(
        'Comments migration stopped: an unsupported foreign-key match mode was found.'
      )
    }

    clauses.push(
      `FOREIGN KEY (${source}) REFERENCES ${quoteIdentifier(first.table)}${target}` +
      ` ON UPDATE ${action(first.on_update)} ON DELETE ${action(first.on_delete)}` +
      (match === 'NONE' ? '' : ` MATCH ${match}`)
    )
  }

  const hasParentReference = foreignKeys.some((foreignKey) =>
    foreignKey.table === 'comments' &&
    foreignKey.from === 'parent_id' &&
    foreignKey.to === 'id'
  )

  if (!hasParentReference) {
    clauses.push(
      'FOREIGN KEY (parent_id) REFERENCES comments(id) ON DELETE CASCADE'
    )
  }

  return clauses
}

function copyExpressions(db, columns) {
  const sourceNames = new Set(columns.map((column) => column.name))
  const expression = (name, fallback = 'NULL') =>
    sourceNames.has(name) ? quoteIdentifier(name) : fallback

  const authorExpression = sourceNames.has('author_name')
    ? sourceNames.has('name')
      ? `COALESCE(NULLIF(${quoteIdentifier('author_name')}, ''), ${quoteIdentifier('name')}, '')`
      : quoteIdentifier('author_name')
    : sourceNames.has('name')
      ? quoteIdentifier('name')
      : null

  if (!authorExpression) {
    throw new Error(
      'Comments migration stopped: neither author_name nor legacy name exists.'
    )
  }

  const chapterExpression = sourceNames.has('chapter_slug')
    ? quoteIdentifier('chapter_slug')
    : sourceNames.has('chapter_id') && tableExists(db, 'chapters')
      ? `(SELECT slug FROM chapters WHERE chapters.id = comments.chapter_id)`
      : 'NULL'

  const createdAt = timestampExpression(
    columns,
    'created_at',
    'CURRENT_TIMESTAMP'
  )
  const updatedAt = timestampExpression(
    columns,
    'updated_at',
    createdAt
  )

  const base = [
    expression('id'),
    expression('manga_id'),
    chapterExpression,
    expression('parent_id'),
    authorExpression,
    expression('content'),
    statusExpression(columns),
    createdAt,
    updatedAt,
  ]

  const known = new Set([
    ...canonicalColumns,
    'name',
  ])
  const extras = columns
    .filter((column) => !known.has(column.name))
    .map((column) => quoteIdentifier(column.name))

  return {
    targetColumns: [...canonicalColumns, ...columns
      .filter((column) => !known.has(column.name))
      .map((column) => column.name)],
    expressions: [...base, ...extras],
    extras: columns.filter((column) => !known.has(column.name)),
  }
}

function extraColumnDefinitions(extraColumns) {
  return extraColumns.map((column) => {
    let definition = `${quoteIdentifier(column.name)} ${column.type || 'BLOB'}`
    if (column.notnull) definition += ' NOT NULL'
    if (column.dflt_value !== null) {
      definition += ` DEFAULT ${column.dflt_value}`
    }
    return definition
  })
}

function preserveIndexes(db) {
  const statements = db.prepare(`
    SELECT name, sql
    FROM sqlite_master
    WHERE type = 'index'
      AND tbl_name = 'comments'
      AND sql IS NOT NULL
    ORDER BY name
  `).all().map((row) => row.sql)

  const automaticUniqueIndexes = db
    .pragma('index_list(comments)')
    .filter((index) => index.origin === 'u')

  for (const [position, index] of automaticUniqueIndexes.entries()) {
    const columns = db
      .pragma(`index_info(${quoteIdentifier(index.name)})`)
      .sort((left, right) => left.seqno - right.seqno)

    if (columns.length === 0 || columns.some((column) => !column.name)) {
      throw new Error(
        'Comments migration stopped: a legacy unique constraint cannot be represented safely.'
      )
    }

    const indexedColumns = columns.map((column) =>
      quoteIdentifier(column.name === 'name' ? 'author_name' : column.name)
    )
    const preservedName = quoteIdentifier(
      `comments__t6_unique_${position + 1}`
    )
    statements.push(
      `CREATE UNIQUE INDEX ${preservedName} ON comments (${indexedColumns.join(', ')})`
    )
  }

  return statements
}

function preserveTriggers(db) {
  return db.prepare(`
    SELECT sql
    FROM sqlite_master
    WHERE type = 'trigger'
      AND tbl_name = 'comments'
      AND sql IS NOT NULL
    ORDER BY name
  `).all().map((row) => row.sql)
}

function rewriteLegacyName(sql, columns) {
  if (!hasColumn(columns, 'name')) {
    return sql
  }

  return sql.replace(/"name"|`name`|\[name\]|\bname\b/gi, 'author_name')
}

function validateLegacyTable(db, columns) {
  for (const name of ['id', 'manga_id', 'content']) {
    if (!hasColumn(columns, name)) {
      throw new Error(
        `Comments migration stopped: required legacy column "${name}" is missing.`
      )
    }
  }

  const idColumn = columns.find((column) => column.name === 'id')
  if (idColumn.pk !== 1 || !/INT/i.test(idColumn.type)) {
    throw new Error(
      'Comments migration stopped: comments.id is not an integer primary key.'
    )
  }

  if (!hasColumn(columns, 'author_name') && !hasColumn(columns, 'name')) {
    throw new Error(
      'Comments migration stopped: neither author_name nor legacy name exists.'
    )
  }

  const tableSql = db.prepare(`
    SELECT sql FROM sqlite_master
    WHERE type = 'table' AND name = 'comments'
  `).get()?.sql || ''
  const checkClauses = tableSql.match(/\bCHECK\s*\(/gi) || []
  if (checkClauses.length > 0) {
    throw new Error(
      'Comments migration stopped: the legacy table has custom CHECK constraints that require a dedicated migration.'
    )
  }

  if (columns.some((column) => column.hidden)) {
    throw new Error(
      'Comments migration stopped: generated or hidden legacy columns are not supported.'
    )
  }

  if (columns.some((column) => column.pk > 0 && column.name !== 'id')) {
    throw new Error(
      'Comments migration stopped: the legacy table has a composite primary key.'
    )
  }

  const commentForeignKeyViolations = db
    .pragma('foreign_key_check')
    .filter((violation) =>
      violation.table === 'comments' ||
      violation.parent === 'comments'
    )
  if (commentForeignKeyViolations.length > 0) {
    throw new Error(
      'Comments migration stopped: existing comment relationships fail foreign-key validation.'
    )
  }
}

function rebuildLegacyComments(db, columns) {
  validateLegacyTable(db, columns)
  validateStatuses(getStatuses(db, columns), true)

  const existingCount = db
    .prepare('SELECT COUNT(*) AS count FROM comments')
    .get().count
  const { targetColumns, expressions, extras } =
    copyExpressions(db, columns)
  const indexes = preserveIndexes(db)
  const triggers = preserveTriggers(db)
  const foreignKeys = foreignKeyClauses(db, columns)
  const extraDefinitions = extraColumnDefinitions(extras)
  const allDefinitions = [
    `id INTEGER PRIMARY KEY AUTOINCREMENT`,
    `manga_id TEXT NOT NULL`,
    `chapter_slug TEXT`,
    `parent_id INTEGER`,
    `author_name TEXT NOT NULL`,
    `content TEXT NOT NULL`,
    `status TEXT NOT NULL DEFAULT 'visible' CHECK (status IN ('visible', 'offensive'))`,
    `created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP`,
    `updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP`,
    ...extraDefinitions,
    ...foreignKeys,
  ]

  if (tableExists(db, 'comments__t6_next')) {
    throw new Error(
      'Comments migration stopped: a temporary migration table already exists.'
    )
  }

  const transaction = db.transaction(() => {
    db.exec(`
      CREATE TABLE comments__t6_next (
        ${allDefinitions.join(',\n        ')}
      )
    `)

    db.prepare(`
      INSERT INTO comments__t6_next (
        ${targetColumns.map(quoteIdentifier).join(', ')}
      )
      SELECT ${expressions.join(', ')}
      FROM comments
    `).run()

    const migratedCount = db
      .prepare('SELECT COUNT(*) AS count FROM comments__t6_next')
      .get().count
    if (migratedCount !== existingCount) {
      throw new Error(
        'Comments migration stopped: the row count changed during migration.'
      )
    }

    db.exec('DROP TABLE comments')
    db.exec('ALTER TABLE comments__t6_next RENAME TO comments')

    for (const sql of indexes) {
      db.exec(rewriteLegacyName(sql, columns))
    }
    for (const sql of triggers) {
      db.exec(rewriteLegacyName(sql, columns))
    }

    const violations = db.pragma('foreign_key_check')
    if (violations.length > 0) {
      throw new Error(
        'Comments migration stopped: foreign-key validation failed.'
      )
    }

    db.prepare(`
      INSERT INTO schema_migrations (version, name)
      VALUES (?, ?)
    `).run(COMMENT_SCHEMA_VERSION, COMMENT_SCHEMA_NAME)
  })

  const foreignKeysEnabled = Boolean(
    db.pragma('foreign_keys', { simple: true })
  )
  if (foreignKeysEnabled) {
    db.pragma('foreign_keys = OFF')
  }

  try {
    transaction()
  } finally {
    if (foreignKeysEnabled) {
      db.pragma('foreign_keys = ON')
    }
  }
}

function recordCanonicalSchema(db) {
  const transaction = db.transaction(() => {
    createCanonicalCommentsTable(db)
    db.prepare(`
      INSERT INTO schema_migrations (version, name)
      VALUES (?, ?)
    `).run(COMMENT_SCHEMA_VERSION, COMMENT_SCHEMA_NAME)
  })
  transaction()
}

export function migrateCommentSchema(db) {
  const migrationsExist = tableExists(db, 'schema_migrations')
  const applied = migrationsExist
    ? db.prepare(`
        SELECT name
        FROM schema_migrations
        WHERE version = ?
      `).get(COMMENT_SCHEMA_VERSION)
    : null
  const commentsExist = tableExists(db, 'comments')

  if (!commentsExist) {
    if (applied) {
      throw new Error(
        'Comments migration state is inconsistent: version 1 is recorded but comments table is missing.'
      )
    }
    ensureMigrationTable(db)
    recordCanonicalSchema(db)
    return
  }

  const columns = db.pragma('table_xinfo(comments)')
  const canonical = isCanonicalSchema(db, columns)
  const statuses = getStatuses(db, columns)

  if (applied) {
    if (!canonical) {
      throw new Error(
        'Comments migration state is inconsistent: version 1 is recorded but the canonical schema has drifted.'
      )
    }
    validateStatuses(statuses, false)
    return
  }

  if (canonical && !statuses.some((status) =>
    String(status ?? '').trim().toLowerCase() === 'pending'
  )) {
    validateStatuses(statuses, false)
    ensureMigrationTable(db)
    db.prepare(`
      INSERT INTO schema_migrations (version, name)
      VALUES (?, ?)
    `).run(COMMENT_SCHEMA_VERSION, COMMENT_SCHEMA_NAME)
    return
  }

  // Complete the read-only preflight before creating migration metadata or rebuilding tables.
  validateLegacyTable(db, columns)
  validateStatuses(statuses, true)
  ensureMigrationTable(db)
  rebuildLegacyComments(db, columns)
}

export const commentSchemaVersion = COMMENT_SCHEMA_VERSION
