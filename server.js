/* global process, Buffer */

import express from 'express'
import 'dotenv/config'
import multer from 'multer'
import session from 'express-session'
import bcrypt from 'bcryptjs'
import rateLimit from 'express-rate-limit'
import { createHash, randomUUID } from 'node:crypto'
import path from 'path'
import fs from 'fs'
import { query as pgQuery } from './database-pg.js'

const app = express()
const PORT = Number(process.env.PORT || 3001)
const HOST = process.env.HOST || '0.0.0.0'

const uploadDirectory = path.join(
  process.cwd(),
  'public',
  'manga-uploads'
)
const uploadStagingDirectory = path.join(
  process.cwd(),
  'data',
  'upload-staging'
)
const maxUploadFiles = 30
const maxUploadFileSize = 15 * 1024 * 1024

fs.mkdirSync(uploadDirectory, {
  recursive: true,
})
fs.mkdirSync(uploadStagingDirectory, {
  recursive: true,
})

function resolveUploadFile(url) {
  const prefix = '/manga-uploads/'
  const hasControlCharacters =
    typeof url === 'string' &&
    [...url].some(
      (character) =>
        character.charCodeAt(0) < 32 ||
        character.charCodeAt(0) === 127
    )

  if (
    typeof url !== 'string' ||
    !url.startsWith(prefix) ||
    url.includes('\\') ||
    url.includes('%') ||
    url.includes('?') ||
    url.includes('#') ||
    hasControlCharacters
  ) {
    return null
  }

  const relativeUrl = url.slice(prefix.length)
  const segments = relativeUrl.split('/')

  if (
    segments.length === 0 ||
    segments.some(
      (segment) =>
        !segment ||
        segment === '.' ||
        segment === '..'
    )
  ) {
    return null
  }

  const root = path.resolve(uploadDirectory)
  const filePath = path.resolve(root, ...segments)
  const relativePath = path.relative(root, filePath)

  if (
    !relativePath ||
    relativePath === '..' ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    return null
  }

  let rootStats

  try {
    rootStats = fs.lstatSync(root)
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { filePath, exists: false }
    }

    throw error
  }

  if (
    rootStats.isSymbolicLink() ||
    !rootStats.isDirectory() ||
    fs.realpathSync(root) !== root
  ) {
    return null
  }

  let currentPath = root

  for (const [index, segment] of segments.entries()) {
    currentPath = path.join(currentPath, segment)

    let stats

    try {
      stats = fs.lstatSync(currentPath)
    } catch (error) {
      if (error.code === 'ENOENT') {
        return { filePath, exists: false }
      }

      throw error
    }

    if (stats.isSymbolicLink()) {
      return null
    }

    const isLastSegment = index === segments.length - 1

    if (
      (isLastSegment && !stats.isFile()) ||
      (!isLastSegment && !stats.isDirectory())
    ) {
      return null
    }
  }

  return { filePath, exists: true }
}

const extensionByMimeType = {
  'image/webp': ['.webp'],
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
}

function getUploadExtension(file) {
  const extension = path
    .extname(file.originalname || '')
    .toLowerCase()
  const allowedExtensions =
    extensionByMimeType[file.mimetype]

  return allowedExtensions?.includes(extension)
    ? extension
    : null
}

const stagingStorage = {
  _handleFile: (_req, file, cb) => {
    const filename = `${randomUUID()}.upload`
    const filePath = path.join(
      uploadStagingDirectory,
      filename
    )

    fs.open(filePath, 'wx', (openError, fd) => {
      if (openError) {
        return cb(openError)
      }

      const output = fs.createWriteStream(
        filePath,
        { fd, autoClose: true }
      )
      let completed = false

      const handleError = (error) => {
        if (completed) {
          return
        }

        completed = true
        output.destroy()
        fs.unlink(filePath, () => cb(error))
      }

      file.stream.once('error', handleError)
      output.once('error', handleError)
      output.once('finish', () => {
        if (completed) {
          return
        }

        completed = true
        cb(null, {
          destination: uploadStagingDirectory,
          filename,
          path: filePath,
          size: output.bytesWritten,
        })
      })

      file.stream.pipe(output)
    })
  },

  _removeFile: (_req, file, cb) => {
    fs.unlink(file.path, (error) => {
      if (error && error.code !== 'ENOENT') {
        return cb(error)
      }

      cb(null)
    })
  },
}

function cleanupStagedFiles(files = []) {
  const errors = []

  for (const file of files) {
    if (!file?.path) {
      continue
    }

    try {
      fs.unlinkSync(file.path)
    } catch (error) {
      if (error.code !== 'ENOENT') {
        errors.push(error)
      }
    }
  }

  return errors
}

function hashFile(filePath) {
  return createHash('sha256')
    .update(fs.readFileSync(filePath))
    .digest('hex')
}

function ensureUploadDirectory(mangaSlug, chapterSlug) {
  const slugs = [mangaSlug, chapterSlug]
  const safeSlug = /^[a-z0-9][a-z0-9_-]*$/i

  if (slugs.some((slug) => !safeSlug.test(slug))) {
    throw new Error('Invalid manga or chapter slug.')
  }

  const root = path.resolve(uploadDirectory)
  const rootStats = fs.lstatSync(root)

  if (
    rootStats.isSymbolicLink() ||
    !rootStats.isDirectory() ||
    fs.realpathSync(root) !== root
  ) {
    throw new Error('Upload root is not a safe directory.')
  }

  let current = root

  for (const slug of slugs) {
    current = path.join(current, slug)

    try {
      fs.mkdirSync(current)
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw error
      }
    }

    const stats = fs.lstatSync(current)

    if (
      stats.isSymbolicLink() ||
      !stats.isDirectory() ||
      fs.realpathSync(current) !== current
    ) {
      throw new Error('Upload path is not a safe directory.')
    }
  }

  return current
}

function installStagedFile(stagedPath, destinationDirectory, extension) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const filename = `${randomUUID()}${extension}`
    const filePath = path.join(
      destinationDirectory,
      filename
    )
    let outputFd
    let inputFd

    try {
      outputFd = fs.openSync(filePath, 'wx', 0o644)
    } catch (error) {
      if (error.code === 'EEXIST') {
        continue
      }

      throw error
    }

    try {
      inputFd = fs.openSync(stagedPath, 'r')
      const buffer = Buffer.allocUnsafe(64 * 1024)
      let bytesRead

      while (
        (bytesRead = fs.readSync(
          inputFd,
          buffer,
          0,
          buffer.length,
          null
        )) > 0
      ) {
        let bytesWritten = 0

        while (bytesWritten < bytesRead) {
          const written = fs.writeSync(
            outputFd,
            buffer,
            bytesWritten,
            bytesRead - bytesWritten,
            null
          )

          if (written === 0) {
            throw new Error('Upload file write was incomplete.')
          }

          bytesWritten += written
        }
      }

      fs.fsyncSync(outputFd)
      fs.closeSync(inputFd)
      fs.closeSync(outputFd)

      return { filename, filePath }
    } catch (error) {
      if (inputFd !== undefined) {
        try {
          fs.closeSync(inputFd)
        } catch {
          // Preserve the original copy error; descriptor cleanup is best effort.
        }
      }

      if (outputFd !== undefined) {
        try {
          fs.closeSync(outputFd)
        } catch {
          // Preserve the original copy error; descriptor cleanup is best effort.
        }
      }

      try {
        fs.unlinkSync(filePath)
      } catch (cleanupError) {
        if (cleanupError.code !== 'ENOENT') {
          console.error(
            'Não foi possível limpar um upload incompleto.'
          )
        }
      }

      throw error
    }
  }

  throw new Error('Could not allocate a unique upload filename.')
}

const upload = multer({
  storage: stagingStorage,

  limits: {
    fileSize: maxUploadFileSize,
    files: maxUploadFiles,
    fields: 1,
    parts: maxUploadFiles + 1,
  },

  fileFilter: (_req, file, cb) => {
    if (!getUploadExtension(file)) {
      return cb(
        new Error(
          'Formato inválido. Envie WEBP, PNG ou JPEG com extensão correspondente.'
        )
      )
    }

    cb(null, true)
  },
})

/* ================================
   SESSÃO DE ADMINISTRAÇÃO
================================ */

app.set('trust proxy', 1)

if (
  !process.env.SESSION_SECRET ||
  !process.env.ADMIN_USERNAME ||
  !process.env.ADMIN_PASSWORD_HASH
) {
  console.error(
    'ERRO: As configurações de autenticação não foram encontradas no .env.'
  )

  process.exit(1)
}

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 1000 * 60 * 60 * 8,
    },
  })
)

/* ================================
   CORS
================================ */

const allowedOrigin =
  process.env.PUBLIC_URL ||
  'http://localhost:5173'

app.use((req, res, next) => {
  res.header(
    'Access-Control-Allow-Origin',
    allowedOrigin
  )
  res.header(
    'Access-Control-Allow-Methods',
    'GET,POST,PATCH,DELETE,OPTIONS'
  )
  res.header(
    'Access-Control-Allow-Headers',
    'Content-Type'
  )
  res.header(
    'Access-Control-Allow-Credentials',
    'true'
  )

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204)
  }

  next()
})

app.use(express.json())

const publicDirectory = path.join(process.cwd(), 'public')
const frontendDirectory = path.join(process.cwd(), 'dist')

app.use(express.static(publicDirectory, { redirect: false }))
app.use(express.static(frontendDirectory, { redirect: false }))

const adminLoginLimiter =
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: {
      error:
        'Muitas tentativas de login. Tente novamente mais tarde.',
    },
  })


/* ================================
   AUTENTICAÇÃO
================================ */

/*
  Fazer login
*/
app.post(
  '/api/admin/login',
  adminLoginLimiter,
  async (req, res) => {
  try {
    const {
      username,
      password,
    } = req.body

    if (!username || !password) {
      return res.status(400).json({
        error:
          'Usuário e senha são obrigatórios.',
      })
    }

    const usernameMatches =
      String(username) ===
      process.env.ADMIN_USERNAME

    const passwordMatches =
      await bcrypt.compare(
        String(password),
        process.env.ADMIN_PASSWORD_HASH
      )

    if (
      !usernameMatches ||
      !passwordMatches
    ) {
      return res.status(401).json({
        error:
          'Usuário ou senha incorretos.',
      })
    }

    req.session.isAdmin = true
    req.session.adminUsername =
      process.env.ADMIN_USERNAME

    res.json({
      success: true,
      username:
        process.env.ADMIN_USERNAME,
    })
  } catch (error) {
    console.error(
      'Erro ao fazer login:',
      error
    )

    res.status(500).json({
      error:
        'Não foi possível realizar o login.',
    })
  }
})

/*
  Verificar sessão atual
*/
app.get('/api/admin/session', (req, res) => {
  if (!req.session.isAdmin) {
    return res.status(401).json({
      authenticated: false,
    })
  }

  res.json({
    authenticated: true,
    username:
      req.session.adminUsername,
  })
})

/*
  Fazer logout
*/
app.post('/api/admin/logout', (req, res) => {
  req.session.destroy((error) => {
    if (error) {
      console.error(
        'Erro ao fazer logout:',
        error
      )

      return res.status(500).json({
        error:
          'Não foi possível sair da conta.',
      })
    }

    res.clearCookie('connect.sid')

    res.json({
      success: true,
    })
  })
})

/*
  Proteger rotas administrativas
*/
function requireAdmin(req, res, next) {
  if (!req.session.isAdmin) {
    return res.status(401).json({
      error:
        'Acesso não autorizado. Faça login como administrador.',
    })
  }

  next()
}

/* ================================
   UPLOAD DE PÁGINAS
================================ */

app.post(
  '/api/upload-page',
  requireAdmin,
  upload.fields([
    { name: 'pages', maxCount: maxUploadFiles },
    { name: 'page', maxCount: 1 },
  ]),
  (error, req, res, next) => {
    const files = [
      ...(req.files?.pages ?? []),
      ...(req.files?.page ?? []),
    ]
    const cleanupErrors = cleanupStagedFiles(files)

    if (cleanupErrors.length > 0) {
      console.error(
        'Falha ao limpar arquivos de um upload rejeitado.'
      )
    }

    if (error) {
      const multerError =
        error instanceof multer.MulterError

      if (error.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
          success: false,
          error:
            'O arquivo é muito grande. O limite é de 15 MB.',
        })
      }

      if (
        multerError &&
        error.code === 'LIMIT_FILE_COUNT'
      ) {
        return res.status(400).json({
          success: false,
          error: `O limite é de ${maxUploadFiles} páginas por envio.`,
        })
      }

      if (multerError) {
        return res.status(400).json({
          success: false,
          error:
            'O formulário de upload contém um campo ou arquivo inválido.',
        })
      }

      return res.status(400).json({
        success: false,
        error:
          'Formato inválido. Envie WEBP, PNG ou JPEG com extensão correspondente.',
      })
    }

    return next()
  },
  async (req, res) => {
    const files = req.files?.pages ?? []
    const legacyFiles = req.files?.page ?? []
    const uploadedFiles = files.length > 0
      ? files
      : legacyFiles
    const installedFiles = []
    let databaseCommitted = false

    const reject = (status, error, details = {}) => {
      const cleanupErrors =
        cleanupStagedFiles(uploadedFiles)

      if (cleanupErrors.length > 0) {
        console.error(
          'Falha ao limpar arquivos temporários de um upload rejeitado.'
        )
      }

      return res.status(status).json({
        success: false,
        error,
        ...details,
      })
    }

    try {
      if (files.length > 0 && legacyFiles.length > 0) {
        return reject(
          400,
          'Envie os arquivos usando apenas um campo de upload.'
        )
      }

      if (uploadedFiles.length === 0) {
        return reject(400, 'Nenhum arquivo foi enviado.')
      }

      const chapterId = Number(
        req.body.chapterId
      )

      if (
        !Number.isInteger(chapterId) ||
        chapterId <= 0
      ) {
        return reject(400, 'ID do capítulo inválido.')
      }

      const chapterResult = await pgQuery(`
        SELECT
          chapters.id,
          chapters.slug AS chapter_slug,
          mangas.slug AS manga_slug
        FROM chapters
        JOIN mangas
          ON mangas.id = chapters.manga_id
        WHERE chapters.id = $1
      `, [chapterId])

      const chapter = chapterResult.rows[0]

      if (!chapter) {
        return reject(404, 'Capítulo não encontrado.')
      }

      const extensions = uploadedFiles.map(
        (file) => getUploadExtension(file)
      )

      if (extensions.some((extension) => !extension)) {
        return reject(
          400,
          'Formato inválido. Envie WEBP, PNG ou JPEG com extensão correspondente.'
        )
      }

      const duplicateIndexes = []
      const knownHashes = new Set()
      const existingPagesResult = await pgQuery(`
        SELECT url
        FROM pages
        WHERE chapter_id = $1
      `, [chapterId])

      const existingPages = existingPagesResult.rows

      for (const page of existingPages) {
        const existingFile = resolveUploadFile(page.url)

        if (existingFile?.exists) {
          knownHashes.add(hashFile(existingFile.filePath))
        }
      }

      for (const [index, file] of uploadedFiles.entries()) {
        const fileHash = hashFile(file.path)

        if (knownHashes.has(fileHash)) {
          duplicateIndexes.push(index + 1)
        } else {
          knownHashes.add(fileHash)
        }
      }

      if (duplicateIndexes.length > 0) {
        return reject(
          409,
          'Um ou mais arquivos têm conteúdo duplicado neste capítulo.',
          { duplicateIndexes }
        )
      }

      const chapterDirectory = ensureUploadDirectory(
        chapter.manga_slug,
        chapter.chapter_slug
      )
      const pagesToInsert = []

      for (const [index, file] of uploadedFiles.entries()) {
        const extension = extensions[index]
        const installed = installStagedFile(
          file.path,
          chapterDirectory,
          extension
        )

        installedFiles.push(installed.filePath)

        const url =
          `/manga-uploads/${chapter.manga_slug}/${chapter.chapter_slug}/${installed.filename}`

        pagesToInsert.push({
          filename: installed.filename,
          url,
        })

        fs.unlinkSync(file.path)
      }

      const nextPageResult = await pgQuery(`
        SELECT COALESCE(MAX(page_number), 0) + 1 AS next_page
        FROM pages
        WHERE chapter_id = $1
      `, [chapterId])

      const nextPageNumber = Number(
        nextPageResult.rows[0].next_page
      )

      const savedPages = []

      for (const [index, page] of pagesToInsert.entries()) {
        const pageNumber = nextPageNumber + index

        const result = await pgQuery(`
          INSERT INTO pages (
            chapter_id,
            page_number,
            url
          )
          VALUES ($1, $2, $3)
          RETURNING id
        `, [
          chapterId,
          pageNumber,
          page.url,
        ])

        savedPages.push({
          id: Number(result.rows[0].id),
          pageNumber,
          url: page.url,
          filename: page.filename,
        })
      }
      databaseCommitted = true

      res.json({
        success: true,
        count: savedPages.length,
        pages: savedPages,
        ...(savedPages.length === 1
          ? {
              ...savedPages[0],
            }
          : {}),
      })
    } catch (error) {
      const cleanupErrors = cleanupStagedFiles(uploadedFiles)
      const installedCleanupErrors = databaseCommitted
        ? []
        : cleanupStagedFiles(
            installedFiles.map((filePath) => ({
              path: filePath,
            }))
          )

      if (
        cleanupErrors.length > 0 ||
        installedCleanupErrors.length > 0
      ) {
        console.error(
          'Falha ao limpar arquivos após upload não concluído.'
        )
      }

      console.error(
        'Não foi possível concluir a resposta de upload:',
        error.code || 'UPLOAD_FAILED'
      )

      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: databaseCommitted
            ? 'As páginas foram salvas, mas não foi possível confirmar o resultado. Atualize o capítulo antes de tentar novamente.'
            : 'Não foi possível concluir o envio das páginas. Nenhuma página do lote foi adicionada ao capítulo.',
        })
      }
    }
  }
)

/* ================================
   EXCLUSÃO DE PÁGINAS
================================ */

app.post(
  '/api/delete-page',
  requireAdmin,
  async (req, res) => {
    const { url } = req.body

    let uploadFile

    try {
      uploadFile = resolveUploadFile(url)
    } catch (error) {
      console.error(
        'Erro ao validar caminho da página:',
        error
      )

      return res.status(500).json({
        error:
          'Não foi possível validar o caminho do arquivo.',
      })
    }

    if (!uploadFile) {
      return res.status(400).json({
        error:
          'Endereço inválido ou fora da área permitida de uploads.',
      })
    }

    try {
      const pageResult = await pgQuery(`
        SELECT id
        FROM pages
        WHERE url = $1
      `, [url])

      const page = pageResult.rows[0]

      if (!page) {
        return res.status(404).json({
          error:
            'Página não encontrada.',
        })
      }

      let fileContents = null
      let fileExisted = uploadFile.exists

      if (fileExisted) {
        try {
          fileContents = fs.readFileSync(
            uploadFile.filePath
          )
        } catch (error) {
          if (error.code === 'ENOENT') {
            fileExisted = false
          } else {
            console.error(
              'Erro ao ler página antes da exclusão:',
              error
            )

            return res.status(500).json({
              error:
                'Não foi possível preparar a exclusão da página.',
            })
          }
        }
      }

      let fileDeleted = false

      try {
        const deleteResult = await pgQuery(`
          DELETE FROM pages
          WHERE id = $1 AND url = $2
        `, [page.id, url])

        if (deleteResult.rowCount !== 1) {
          const error = new Error(
            'O registro da página mudou durante a exclusão.'
          )
          error.status = 409
          throw error
        }

        if (fileExisted) {
          try {
            fs.unlinkSync(uploadFile.filePath)
            fileDeleted = true
          } catch (error) {
            if (error.code !== 'ENOENT') {
              throw error
            }

            fileExisted = false
          }
        }
      } catch (error) {
        if (
          fileContents &&
          !fs.existsSync(uploadFile.filePath)
        ) {
          try {
            fs.writeFileSync(
              uploadFile.filePath,
              fileContents,
              { flag: 'wx' }
            )
          } catch (restoreError) {
            console.error(
              'Não foi possível restaurar a página após falha na exclusão:',
              restoreError
            )
          }
        }

        console.error(
          'Erro ao excluir página:',
          error
        )

        return res.status(error.status || 500).json({
          error:
            'Não foi possível concluir a exclusão da página.',
        })
      }

      return res.json({
        success: true,
        recordDeleted: true,
        fileDeleted,
      })
    } catch (error) {
      console.error(
        'Erro ao excluir página:',
        error
      )

      return res.status(500).json({
        error:
          'Não foi possível concluir a exclusão da página.',
      })
    }
  }
)

/* ================================
   EXCLUIR CAPÍTULO
================================ */

app.delete(
  '/api/admin/chapters/:id',
  requireAdmin,
  async (req, res) => {
    try {
      const chapterId = Number(
        req.params.id
      )

      if (
        !Number.isInteger(chapterId) ||
        chapterId <= 0
      ) {
        return res.status(400).json({
          error:
            'ID do capítulo inválido.',
        })
      }

      const chapterResult = await pgQuery(`
        SELECT
          id,
          title
        FROM chapters
        WHERE id = $1
      `, [chapterId])

      const chapter = chapterResult.rows[0]

      if (!chapter) {
        return res.status(404).json({
          error:
            'Capítulo não encontrado.',
        })
      }

      const pagesResult = await pgQuery(`
        SELECT url
        FROM pages
        WHERE chapter_id = $1
        ORDER BY page_number
      `, [chapterId])

      for (const page of pagesResult.rows) {
        if (
          typeof page.url !== 'string' ||
          !page.url.startsWith(
            '/manga-uploads/'
          )
        ) {
          continue
        }

        const uploadFile =
          resolveUploadFile(page.url)

        if (!uploadFile) {
          console.error(
            'Caminho de página inválido durante exclusão:',
            page.url
          )
          continue
        }

        if (!uploadFile.exists) {
          continue
        }

        try {
          fs.unlinkSync(uploadFile.filePath)
        } catch (error) {
          if (error.code !== 'ENOENT') {
            throw error
          }
        }
      }

      const deleteResult = await pgQuery(`
        DELETE FROM chapters
        WHERE id = $1
      `, [chapterId])

      if (deleteResult.rowCount !== 1) {
        return res.status(409).json({
          error:
            'O capítulo mudou durante a exclusão.',
        })
      }

      res.json({
        success: true,
        chapterId,
      })
    } catch (error) {
      console.error(
        'Erro ao excluir capítulo:',
        error
      )

      res.status(500).json({
        error:
          'Não foi possível excluir o capítulo.',
      })
    }
  }
)

/* ================================
   COMENTÁRIOS PÚBLICOS
================================ */

/*
  Criar comentário ou resposta
*/
app.post('/api/comments', async (req, res) => {
  try {
    const {
      mangaId,
      chapterSlug,
      parentId,
      authorName,
      content,
    } = req.body

    if (
      !mangaId ||
      !authorName ||
      !content
    ) {
      return res.status(400).json({
        error:
          'Mangá, nome e comentário são obrigatórios.',
      })
    }

    const cleanName =
      String(authorName).trim()

    const cleanContent =
      String(content).trim()

    if (!cleanName || !cleanContent) {
      return res.status(400).json({
        error:
          'Nome e comentário não podem estar vazios.',
      })
    }

    if (cleanName.length > 50) {
      return res.status(400).json({
        error:
          'O nome pode ter no máximo 50 caracteres.',
      })
    }

    if (cleanContent.length > 2000) {
      return res.status(400).json({
        error:
          'O comentário pode ter no máximo 2000 caracteres.',
      })
    }

    if (
      parentId !== null &&
      parentId !== undefined
    ) {
      const parentResult = await pgQuery(`
        SELECT id
        FROM comments
        WHERE id = $1
      `, [parentId])

      if (parentResult.rowCount === 0) {
        return res.status(400).json({
          error:
            'O comentário ao qual você está respondendo não existe.',
        })
      }
    }

    const result = await pgQuery(`
      INSERT INTO comments (
        manga_id,
        chapter_slug,
        parent_id,
        author_name,
        content
      )
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [
      String(mangaId),
      chapterSlug
        ? String(chapterSlug)
        : null,
      parentId ?? null,
      cleanName,
      cleanContent,
    ])

    const comment = result.rows[0]

    res.status(201).json({
      success: true,
      comment,
    })
  } catch (error) {
    console.error(
      'Erro ao criar comentário:',
      error
    )

    res.status(500).json({
      error:
        'Não foi possível criar o comentário.',
    })
  }
})


/*
  Listar comentários públicos
*/
app.get('/api/comments', async (req, res) => {
  try {
    const {
      mangaId,
      chapterSlug,
    } = req.query

    if (!mangaId) {
      return res.status(400).json({
        error:
          'O mangaId é obrigatório.',
      })
    }

    let result

    if (chapterSlug) {
      result = await pgQuery(`
        SELECT *
        FROM comments
        WHERE manga_id = $1
          AND chapter_slug = $2
        ORDER BY created_at ASC, id ASC
      `, [
        String(mangaId),
        String(chapterSlug),
      ])
    } else {
      result = await pgQuery(`
        SELECT *
        FROM comments
        WHERE manga_id = $1
          AND chapter_slug IS NULL
        ORDER BY created_at ASC, id ASC
      `, [
        String(mangaId),
      ])
    }

    res.json({
      success: true,
      comments: result.rows,
    })
  } catch (error) {
    console.error(
      'Erro ao buscar comentários:',
      error
    )

    res.status(500).json({
      error:
        'Não foi possível buscar os comentários.',
    })
  }
})


/* ================================
   ADMINISTRAÇÃO DE COMENTÁRIOS
================================ */

/*
  Listar todos os comentários
*/
app.get(
  '/api/admin/comments',
  requireAdmin,
  async (req, res) => {
    try {
      const { mangaId } = req.query

      let result

      if (mangaId) {
        result = await pgQuery(`
          SELECT *
          FROM comments
          WHERE manga_id = $1
          ORDER BY created_at ASC, id ASC
        `, [
          String(mangaId),
        ])
      } else {
        result = await pgQuery(`
          SELECT *
          FROM comments
          ORDER BY created_at ASC, id ASC
        `)
      }

      res.json({
        success: true,
        comments: result.rows,
      })
    } catch (error) {
      console.error(
        'Erro ao buscar comentários para administração:',
        error
      )

      res.status(500).json({
        error:
          'Não foi possível buscar os comentários.',
      })
    }
  }
)


/*
  Alterar status do comentário
*/
app.patch(
  '/api/admin/comments/:id/status',
  requireAdmin,
  async (req, res) => {
    try {
      const commentId =
        Number(req.params.id)

      const { status } = req.body

      if (!Number.isInteger(commentId)) {
        return res.status(400).json({
          error:
            'ID de comentário inválido.',
        })
      }

      if (
        status !== 'visible' &&
        status !== 'offensive'
      ) {
        return res.status(400).json({
          error:
            'Status inválido.',
        })
      }

      const existingCommentResult = await pgQuery(`
        SELECT id
        FROM comments
        WHERE id = $1
      `, [commentId])

      if (existingCommentResult.rowCount === 0) {
        return res.status(404).json({
          error:
            'Comentário não encontrado.',
        })
      }

      const commentResult = await pgQuery(`
        UPDATE comments
        SET
          status = $1,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
        RETURNING *
      `, [
        status,
        commentId,
      ])

      const comment = commentResult.rows[0]

      res.json({
        success: true,
        comment,
      })
    } catch (error) {
      console.error(
        'Erro ao alterar status do comentário:',
        error
      )

      res.status(500).json({
        error:
          'Não foi possível alterar o status do comentário.',
      })
    }
  }
)


/*
  Excluir comentário
*/
app.delete(
  '/api/admin/comments/:id',
  requireAdmin,
  async (req, res) => {
    try {
      const commentId =
        Number(req.params.id)

      if (!Number.isInteger(commentId)) {
        return res.status(400).json({
          error:
            'ID de comentário inválido.',
        })
      }

      const existingCommentResult =
        await pgQuery(`
          SELECT id
          FROM comments
          WHERE id = $1
        `, [commentId])

      if (existingCommentResult.rowCount === 0) {
        return res.status(404).json({
          error:
            'Comentário não encontrado.',
        })
      }

      const deleteResult =
        await pgQuery(`
          DELETE FROM comments
          WHERE id = $1
        `, [commentId])

      if (deleteResult.rowCount !== 1) {
        return res.status(409).json({
          error:
            'O comentário mudou durante a exclusão.',
        })
      }

      res.json({
        success: true,
        message:
          'Comentário excluído com sucesso.',
      })
    } catch (error) {
      console.error(
        'Erro ao excluir comentário:',
        error
      )

      res.status(500).json({
        error:
          'Não foi possível excluir o comentário.',
      })
    }
  }
)


/* ================================
   API PÚBLICA DE MANGÁS
================================ */

app.get('/api/mangas', async (_req, res) => {
  try {
    const mangasResult = await pgQuery(`
      SELECT
        id,
        title,
        volume,
        description,
        cover,
        slug
      FROM mangas
      ORDER BY id
    `)

    const result = []

    for (const manga of mangasResult.rows) {
      const chaptersResult = await pgQuery(`
        SELECT
          id,
          number,
          title,
          slug,
          reader_url
        FROM chapters
        WHERE manga_id = $1
        ORDER BY number
      `, [manga.id])

      const chapters = []

      for (const chapter of chaptersResult.rows) {
        const pagesResult = await pgQuery(`
          SELECT
            id,
            page_number,
            url
          FROM pages
          WHERE chapter_id = $1
          ORDER BY page_number
        `, [chapter.id])

        chapters.push({
          id: chapter.id,
          number: chapter.number,
          title: chapter.title,
          slug: chapter.slug,
          readerUrl: chapter.reader_url,
          pages: pagesResult.rows.map(
            (page) => page.url
          ),
          pageIds: pagesResult.rows.map(
            (page) => page.id
          ),
        })
      }

      result.push({
        ...manga,
        chapters,
      })
    }

    res.json({
      mangas: result,
    })
  } catch (error) {
    console.error(
      'Erro ao carregar mangás:',
      error
    )

    res.status(500).json({
      error:
        'Não foi possível carregar os mangás.',
    })
  }
})

/* ================================
   API ADMINISTRATIVA DE MANGÁS
================================ */

app.post(
  '/api/admin/mangas',
  requireAdmin,
  async (req, res) => {
    const {
      id: rawId,
      title: rawTitle,
      volume: rawVolume,
      description: rawDescription,
      cover: rawCover,
      slug: rawSlug,
    } = req.body ?? {}

    if (
      typeof rawId !== 'string' ||
      typeof rawTitle !== 'string' ||
      typeof rawSlug !== 'string'
    ) {
      return res.status(400).json({
        success: false,
        error: 'ID, título e slug são obrigatórios.',
      })
    }

    const manga = {
      id: rawId.trim(),
      title: rawTitle.trim(),
      volume: rawVolume == null ? null : rawVolume,
      description: rawDescription == null ? null : rawDescription,
      cover: rawCover == null ? null : rawCover,
      slug: rawSlug.trim(),
    }

    if (
      !manga.id ||
      !manga.title ||
      !manga.slug ||
      manga.id.length > 100 ||
      manga.title.length > 200 ||
      manga.slug.length > 100 ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(manga.slug)
    ) {
      return res.status(400).json({
        success: false,
        error: 'Informe ID, título e slug válidos.',
      })
    }

    for (const field of ['volume', 'description', 'cover']) {
      if (manga[field] != null && typeof manga[field] !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'Volume, descrição e capa devem ser textos.',
        })
      }

      if (typeof manga[field] === 'string') {
        manga[field] = manga[field].trim() || null
      }
    }

    if (
      (manga.volume?.length ?? 0) > 120 ||
      (manga.description?.length ?? 0) > 5000 ||
      (manga.cover?.length ?? 0) > 1000
    ) {
      return res.status(400).json({
        success: false,
        error: 'Um ou mais campos excedem o tamanho permitido.',
      })
    }

    try {
      const duplicate = await pgQuery(`
        SELECT id, slug
        FROM mangas
        WHERE id = $1 OR slug = $2
        LIMIT 1
      `, [manga.id, manga.slug])

      if (duplicate.rows.length > 0) {
        return res.status(409).json({
          success: false,
          error: 'Já existe um mangá com esse ID ou slug.',
        })
      }

      await pgQuery(`
        INSERT INTO mangas (
          id,
          title,
          volume,
          description,
          cover,
          slug
        )
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [
        manga.id,
        manga.title,
        manga.volume,
        manga.description,
        manga.cover,
        manga.slug,
      ])

      return res.status(201).json({
        success: true,
        manga: {
          ...manga,
          chapters: [],
        },
      })
    } catch (error) {
      if (
        error.code === '23505'
      ) {
        return res.status(409).json({
          success: false,
          error: 'Já existe um mangá com esse ID ou slug.',
        })
      }

      console.error(
        'Erro ao criar mangá:',
        error.code || 'CREATE_MANGA_FAILED'
      )

      return res.status(500).json({
        success: false,
        error: 'Não foi possível criar o mangá.',
      })
    }
  }
)

/* ================================
   API ADMINISTRATIVA DE CAPÍTULOS
================================ */

app.post(
  '/api/admin/chapters',
  requireAdmin,
  async (req, res) => {
    try {
      const {
        mangaId,
        number,
        title,
        slug,
      } = req.body

      if (
        !mangaId ||
        number === undefined ||
        !title ||
        !slug
      ) {
        return res.status(400).json({
          error:
            'Dados incompletos para criar o capítulo.',
        })
      }

      const mangaResult = await pgQuery(`
        SELECT id, slug
        FROM mangas
        WHERE id = $1
      `, [mangaId])

      const manga = mangaResult.rows[0]

      if (!manga) {
        return res.status(404).json({
          error: 'Mangá não encontrado.',
        })
      }

      const existingChapterResult = await pgQuery(`
        SELECT id
        FROM chapters
        WHERE manga_id = $1
          AND slug = $2
      `, [mangaId, slug])

      if (existingChapterResult.rows.length > 0) {
        return res.status(409).json({
          error:
            'Já existe um capítulo com esse slug.',
        })
      }

      const readerUrl =
        `/manga/${manga.slug}/${slug}`

      const result = await pgQuery(`
        INSERT INTO chapters (
          manga_id,
          number,
          title,
          slug,
          reader_url
        )
        VALUES ($1, $2, $3, $4, $5)
        RETURNING
          id,
          number,
          title,
          slug,
          reader_url
      `, [
        mangaId,
        Number(number),
        title,
        slug,
        readerUrl,
      ])

      const chapter = result.rows[0]

      res.status(201).json({
        success: true,
        chapter: {
          id: chapter.id,
          number: chapter.number,
          title: chapter.title,
          slug: chapter.slug,
          readerUrl: chapter.reader_url,
          pages: [],
        },
      })
    } catch (error) {
      if (error.code === '23505') {
        return res.status(409).json({
          error:
            'Já existe um capítulo com esse slug.',
        })
      }

      console.error(
        'Erro ao criar capítulo:',
        error
      )

      res.status(500).json({
        error:
          'Não foi possível criar o capítulo.',
      })
    }
  }
)

/* ================================
   API ADMINISTRATIVA DE PÁGINAS
================================ */

app.patch(
  '/api/admin/chapters/:chapterId/pages/order',
  requireAdmin,
  async (req, res) => {
    try {
      const chapterId = Number(
        req.params.chapterId
      )

      const { pageIds } = req.body

      if (
        !Number.isInteger(chapterId) ||
        chapterId <= 0
      ) {
        return res.status(400).json({
          error:
            'ID do capítulo inválido.',
        })
      }

      if (!Array.isArray(pageIds)) {
        return res.status(400).json({
          error:
            'A lista de páginas é inválida.',
        })
      }

      if (
        pageIds.length === 0
      ) {
        return res.status(400).json({
          error:
            'O capítulo não possui páginas.',
        })
      }

      const normalizedIds =
        pageIds.map(Number)

      if (
        normalizedIds.some(
          (id) =>
            !Number.isInteger(id) ||
            id <= 0
        )
      ) {
        return res.status(400).json({
          error:
            'A lista contém IDs de páginas inválidos.',
        })
      }

      const uniqueIds =
        new Set(normalizedIds)

      if (
        uniqueIds.size !==
        normalizedIds.length
      ) {
        return res.status(400).json({
          error:
            'A lista contém páginas duplicadas.',
        })
      }

      const pagesResult = await pgQuery(`
        SELECT id
        FROM pages
        WHERE chapter_id = $1
        ORDER BY page_number
      `, [chapterId])

      const pages = pagesResult.rows

      if (
        pages.length !==
        normalizedIds.length
      ) {
        return res.status(400).json({
          error:
            'A quantidade de páginas não corresponde ao capítulo.',
        })
      }

      const chapterPageIds =
        new Set(
          pages.map(
            (page) => page.id
          )
        )

      const allPagesBelongToChapter =
        normalizedIds.every(
          (id) =>
            chapterPageIds.has(id)
        )

      if (
        !allPagesBelongToChapter
      ) {
        return res.status(400).json({
          error:
            'Uma ou mais páginas não pertencem a este capítulo.',
        })
      }

      const reorderPages = async () => {
        // Primeiro usamos números temporários negativos
        // para evitar conflito com a restrição UNIQUE.
        for (const [index, pageId] of normalizedIds.entries()) {
          await pgQuery(`
            UPDATE pages
            SET page_number = $1
            WHERE id = $2
              AND chapter_id = $3
          `, [
            -(index + 1),
            pageId,
            chapterId,
          ])
        }

        // Depois aplicamos a numeração definitiva.
        for (const [index, pageId] of normalizedIds.entries()) {
          await pgQuery(`
            UPDATE pages
            SET page_number = $1
            WHERE id = $2
              AND chapter_id = $3
          `, [
            index + 1,
            pageId,
            chapterId,
          ])
        }
      }

      await reorderPages()

      res.json({
        success: true,
        chapterId,
        pageIds: normalizedIds,
      })
    } catch (error) {
      console.error(
        'Erro ao reordenar páginas:',
        error
      )

      res.status(500).json({
        error:
          'Não foi possível reordenar as páginas.',
      })
    }
  }
)

/* ================================
   FRONTEND SPA FALLBACK
================================ */

app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return next()
  }

  if (req.path === '/api' || req.path.startsWith('/api/')) {
    return next()
  }

  // Missing files/assets must remain 404s instead of returning the SPA HTML.
  if (path.extname(req.path)) {
    return next()
  }

  const indexPath = path.join(frontendDirectory, 'index.html')
  if (!fs.existsSync(indexPath)) {
    return next()
  }

  res.sendFile(indexPath, (error) => {
    if (error) next(error)
  })
})

/* ================================
   SERVIDOR
================================ */

app.listen(PORT, HOST, () => {
  console.log(
    `Servidor de upload, comentários e autenticação rodando em http://${HOST}:${PORT}`
  )
})
