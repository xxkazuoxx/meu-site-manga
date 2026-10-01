import { useEffect, useState } from 'react'
import { fetchMangaData } from '../mangaStorage'
import { apiUrl } from '../api'
import './AdminPage.css'

function AdminPage() {
  const [authenticated, setAuthenticated] =
    useState(null)

  const [loginUsername, setLoginUsername] =
    useState('admin')

  const [loginPassword, setLoginPassword] =
    useState('')

  const [loginError, setLoginError] =
    useState('')

  const [loginLoading, setLoginLoading] =
    useState(false)

  useEffect(() => {
    async function checkAdminSession() {
      try {
        const response = await fetch(
          apiUrl('/admin/session'),
          {
            credentials: 'include',
          }
        )

        if (!response.ok) {
          setAuthenticated(false)
          return
        }

        const data = await response.json()

        if (data.authenticated) {
          setAuthenticated(true)
        } else {
          setAuthenticated(false)
        }
      } catch (error) {
        console.error(
          'Erro ao verificar sessão administrativa:',
          error
        )

        setAuthenticated(false)
      }
    }

    checkAdminSession()
  }, [])
  const [mangas, setMangas] =
    useState([])

  const [draggedPageIndex, setDraggedPageIndex] =
    useState(null)
    function handlePageDragStart(index) {
    setDraggedPageIndex(index)
  }

  function handlePageDragOver(event) {
    event.preventDefault()
  }

  async function handlePageDrop(targetIndex) {
    if (
      draggedPageIndex === null ||
      draggedPageIndex === targetIndex
    ) {
      setDraggedPageIndex(null)
      return
    }

    const pages = [...selectedChapter.pages]
    const pageIds = [...selectedChapter.pageIds]

    const [movedPage] = pages.splice(
      draggedPageIndex,
      1
    )

    const [movedPageId] = pageIds.splice(
      draggedPageIndex,
      1
    )

    pages.splice(targetIndex, 0, movedPage)
    pageIds.splice(targetIndex, 0, movedPageId)

    setDraggedPageIndex(null)

    setMangas((currentMangas) =>
      currentMangas.map((manga) => {
        if (manga.id !== selectedManga.id) {
          return manga
        }

        return {
          ...manga,
          chapters: manga.chapters.map(
            (chapter) => {
              if (
                chapter.id !== selectedChapter.id
              ) {
                return chapter
              }

              return {
                ...chapter,
                pages,
                pageIds,
              }
            }
          ),
        }
      })
    )

    try {
      const response = await fetch(
        apiUrl(`/admin/chapters/${selectedChapter.id}/pages/order`),
        {
          method: 'PATCH',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            pageIds,
          }),
        }
      )

      if (!response.ok) {
        const result = await response.json()

        throw new Error(
          result.error ||
            'Não foi possível salvar a nova ordem.'
        )
      }
    } catch (error) {
      console.error(
        'Erro ao reordenar páginas:',
        error
      )

      alert(
        error.message ||
          'Não foi possível salvar a nova ordem das páginas.'
      )

      const data = await fetchMangaData()
      setMangas(data.mangas || [])
    }
  }
  useEffect(() => {
    async function loadMangas() {
      try {
        const data = await fetchMangaData()

        setMangas(data.mangas || [])
      } catch (error) {
        console.error(
          'Erro ao carregar mangás:',
          error
        )
      }
    }

    loadMangas()
  }, [])

  const [selectedManga, setSelectedManga] =
    useState(null)

  const [selectedChapterSlug, setSelectedChapterSlug] =
    useState(null)

  const [selectedFiles, setSelectedFiles] =
    useState([])

  const [isUploadingPages, setIsUploadingPages] =
    useState(false)

  const [comments, setComments] =
    useState([])

  const [commentsMangaId, setCommentsMangaId] =
    useState(null)

  const [commentsLoading, setCommentsLoading] =
    useState(false)

  const [commentsError, setCommentsError] =
    useState('')

  const [replyingTo, setReplyingTo] =
    useState(null)

  const [adminReply, setAdminReply] =
    useState('')

  const [sendingAdminReply, setSendingAdminReply] =
    useState(false)

  const currentManga = mangas.find(
    (manga) => manga.id === selectedManga
  )

  const selectedChapter =
    currentManga?.chapters.find(
      (chapter) =>
        chapter.slug === selectedChapterSlug
    )

  function updateMangas(updater) {
    setMangas((currentMangas) => {
      const nextMangas =
        typeof updater === 'function'
          ? updater(currentMangas)
          : updater

      return nextMangas
    })
  }

  async function createChapter() {
    if (!currentManga) {
      return
    }

    const nextNumber =
      currentManga.chapters.reduce(
        (highest, chapter) =>
          Math.max(
            highest,
            Number(chapter.number) || 0
          ),
        0
      ) + 1

    const title = `Capítulo ${nextNumber}`
    const slug = `capitulo-${nextNumber}`

    try {
      const response = await fetch(
        apiUrl('/admin/chapters'),
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({
            mangaId: currentManga.id,
            number: nextNumber,
            title,
            slug,
          }),
        }
      )

      const result = await response.json()

      if (!response.ok) {
        throw new Error(
          result.error ||
            'Não foi possível criar o capítulo.'
        )
      }

      const newChapter = result.chapter

      setMangas((currentMangas) =>
        currentMangas.map((manga) => {
          if (manga.id !== currentManga.id) {
            return manga
          }

          return {
            ...manga,
            chapters: [
              ...manga.chapters,
              newChapter,
            ],
          }
        })
      )

      setSelectedChapterSlug(
        newChapter.slug
      )
    } catch (error) {
      console.error(
        'Erro ao criar capítulo:',
        error
      )

      alert(
        error.message ||
          'Não foi possível criar o capítulo.'
      )
    }
  }

  async function savePages() {
    if (
      !currentManga ||
      !selectedChapter ||
      selectedFiles.length === 0
    ) {
      return
    }

    setIsUploadingPages(true)

    const formData = new FormData()
    formData.append(
      'chapterId',
      String(selectedChapter.id)
    )

    for (const file of selectedFiles) {
      formData.append('pages', file)
    }

    try {
      const response = await fetch(
        apiUrl('/upload-page'),
        {
          method: 'POST',
          credentials: 'include',
          body: formData,
        }
      )

      const result = await response.json().catch(
        () => ({})
      )

      if (!response.ok || !result.success) {
        throw new Error(
          result.error ||
            'Falha ao enviar as páginas.'
        )
      }

      setSelectedFiles([])
      setSelectedChapterSlug(null)

      try {
        const data = await fetchMangaData()
        setMangas(data.mangas || [])
      } catch (error) {
        console.error(
          'Upload concluído, mas não foi possível atualizar os dados:',
          error
        )

        alert(
          'As páginas foram enviadas, mas a lista não pôde ser atualizada. Recarregue os dados antes de tentar novamente.'
        )
      }
    } catch (error) {
      console.error(
        'Erro ao salvar páginas:',
        error
      )

      alert(
        error.message ||
          'Não foi possível salvar as páginas.'
      )
    } finally {
      setIsUploadingPages(false)
    }
  }

  const currentMangaId = currentManga?.id
  useEffect(() => {
    let cancelled = false

    if (!currentMangaId) {
      return () => {
        cancelled = true
      }
    }

    async function loadSelectedMangaComments() {
      try {
        setCommentsError('')
        const response = await fetch(
          apiUrl(`/admin/comments?mangaId=${encodeURIComponent(currentMangaId)}`),
          { credentials: 'include' }
        )

        if (!response.ok) {
          throw new Error(
            'Não foi possível carregar os comentários.'
          )
        }

        const data = await response.json()
        if (!cancelled) {
          setComments(data.comments ?? [])
          setCommentsMangaId(currentMangaId)
          setCommentsLoading(false)
        }
      } catch (error) {
        console.error(error)

        if (!cancelled) {
          setCommentsError(
            'Não foi possível carregar os comentários.'
          )
          setCommentsLoading(false)
        }
      }
    }

    loadSelectedMangaComments()
    return () => {
      cancelled = true
    }
  }, [currentMangaId])

  async function loadComments() {
    if (!currentMangaId) {
      setComments([])
      setCommentsMangaId(null)
      return
    }

    try {
      setCommentsLoading(true)
      setCommentsError('')
      const response = await fetch(
        apiUrl(`/admin/comments?mangaId=${encodeURIComponent(currentMangaId)}`),
        { credentials: 'include' }
      )

      if (!response.ok) {
        throw new Error(
          'Não foi possível carregar os comentários.'
        )
      }

      const data = await response.json()
      setComments(data.comments ?? [])
      setCommentsMangaId(currentMangaId)
    } catch (error) {
      console.error(error)
      setCommentsError(
        'Não foi possível carregar os comentários.'
      )
    } finally {
      setCommentsLoading(false)
    }
  }

  async function changeCommentStatus(
    commentId,
    status
  ) {
    try {
      const response = await fetch(
        apiUrl(`/admin/comments/${commentId}/status`),
        {
          method: 'PATCH',
          credentials: 'include',
          headers: {
            'Content-Type':
              'application/json',
          },
          body: JSON.stringify({
            status,
          }),
        }
      )

      const data =
        await response.json()

      if (
        !response.ok ||
        !data.success
      ) {
        throw new Error(
          data.error ||
            'Não foi possível alterar o comentário.'
        )
      }

      setComments(
        (currentComments) =>
          currentComments.map(
            (comment) =>
              comment.id ===
              commentId
                ? data.comment
                : comment
          )
      )
    } catch (error) {
      console.error(error)

      alert(
        error.message ||
          'Não foi possível alterar o comentário.'
      )
    }
  }

  async function deletePage(pageUrl) {
    if (
      !currentManga ||
      !selectedChapter
    ) {
      return
    }

    const confirmed = window.confirm(
      'Tem certeza que deseja excluir esta página?\\n\\nEsta ação removerá o arquivo da página.'
    )

    if (!confirmed) {
      return
    }

    try {
      const response = await fetch(
        apiUrl('/delete-page'),
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({
            url: pageUrl,
          }),
        }
      )

      const data =
        await response.json()

      if (
        !response.ok ||
        !data.success
      ) {
        throw new Error(
          data.error ||
            'Não foi possível excluir a página.'
        )
      }

      updateMangas(
        (currentMangas) =>
          currentMangas.map((manga) => {
            if (
              manga.id !==
              currentManga.id
            ) {
              return manga
            }

            return {
              ...manga,
              chapters:
                manga.chapters.map(
                  (chapter) => {
                    if (
                      chapter.slug !==
                      selectedChapter.slug
                    ) {
                      return chapter
                    }

                    return {
                      ...chapter,
                      pages:
                        chapter.pages.filter(
                          (page) =>
                            page !==
                            pageUrl
                        ),
                    }
                  }
                ),
            }
          })
      )
    } catch (error) {
      console.error(error)

      alert(
        error.message ||
          'Não foi possível excluir a página.'
      )
    }
  }

  async function deleteChapter(chapter) {
    if (!currentManga) {
      return
    }

    const confirmed = window.confirm(
      `Tem certeza que deseja excluir ${chapter.title}?\n\nTodas as ${chapter.pages.length} página(s) deste capítulo também serão excluídas.\n\nEsta ação não pode ser desfeita.`
    )

    if (!confirmed) {
      return
    }

    try {
      const response = await fetch(
        apiUrl(`/admin/chapters/${chapter.id}`),
        {
          method: 'DELETE',
          credentials: 'include',
        }
      )

      const data =
        await response.json()

      if (
        !response.ok ||
        !data.success
      ) {
        throw new Error(
          data.error ||
            'Não foi possível excluir o capítulo.'
        )
      }

      setMangas((currentMangas) =>
        currentMangas.map((manga) => {
          if (
            manga.id !==
            currentManga.id
          ) {
            return manga
          }

          return {
            ...manga,
            chapters:
              manga.chapters.filter(
                (item) =>
                  item.id !== chapter.id
              ),
          }
        })
      )

      if (
        selectedChapterSlug ===
        chapter.slug
      ) {
        setSelectedChapterSlug(null)
        setSelectedFiles([])
      }

      alert(
        'Capítulo excluído com sucesso.'
      )
    } catch (error) {
      console.error(
        'Erro ao excluir capítulo:',
        error
      )

      alert(
        error.message ||
          'Não foi possível excluir o capítulo.'
      )
    }
  }

  async function deleteComment(
    commentId
  ) {
    const confirmed =
      window.confirm(
        'Tem certeza que deseja excluir este comentário? As respostas dele também serão excluídas.'
      )

    if (!confirmed) {
      return
    }

    try {
      const response = await fetch(
  apiUrl(`/admin/comments/${commentId}`),
  {
    method: 'DELETE',
    credentials: 'include',
  }
)

      const data =
        await response.json()

      if (
        !response.ok ||
        !data.success
      ) {
        throw new Error(
          data.error ||
            'Não foi possível excluir o comentário.'
        )
      }

      setComments(
        (currentComments) =>
          currentComments.filter(
            (comment) =>
              comment.id !==
                commentId &&
              comment.parent_id !==
                commentId
          )
      )
    } catch (error) {
      console.error(error)

      alert(
        error.message ||
          'Não foi possível excluir o comentário.'
      )
    }
  }
  async function handleAdminLogin(event) {
    event.preventDefault()

    if (
      !loginUsername.trim() ||
      !loginPassword
    ) {
      setLoginError(
        'Digite o usuário e a senha.'
      )
      return
    }

    try {
      setLoginLoading(true)
      setLoginError('')

      const response = await fetch(
        apiUrl('/admin/login'),
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({
            username:
              loginUsername.trim(),
            password: loginPassword,
          }),
        }
      )

      const data =
        await response.json()

      if (
        !response.ok ||
        !data.success
      ) {
        throw new Error(
          data.error ||
            'Usuário ou senha incorretos.'
        )
      }

      setAuthenticated(true)
      setLoginPassword('')
    } catch (error) {
      console.error(error)

      setLoginError(
        error.message ||
          'Não foi possível fazer login.'
      )
    } finally {
      setLoginLoading(false)
    }
  }
  function startAdminReply(comment) {
    setReplyingTo(comment)
    setAdminReply('')

    setTimeout(() => {
      document
        .querySelector(
          '.admin-reply-form'
        )
        ?.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        })
    }, 50)
  }

  function cancelAdminReply() {
    setReplyingTo(null)
    setAdminReply('')
  }

  async function sendAdminReply(
    event
  ) {
    event.preventDefault()

    if (
      !replyingTo ||
      !adminReply.trim()
    ) {
      return
    }

    try {
      setSendingAdminReply(true)

      const response = await fetch(
        apiUrl('/comments'),
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type':
              'application/json',
          },
          body: JSON.stringify({
            mangaId:
              replyingTo.manga_id,
            chapterSlug:
              replyingTo.chapter_slug,
            parentId:
              replyingTo.id,
            authorName:
              'Administrador',
            content:
              adminReply.trim(),
          }),
        }
      )

      const data =
        await response.json()

      if (
        !response.ok ||
        !data.success
      ) {
        throw new Error(
          data.error ||
            'Não foi possível enviar a resposta.'
        )
      }

      setComments(
        (currentComments) => [
          ...currentComments,
          data.comment,
        ]
      )

      setReplyingTo(null)
      setAdminReply('')
    } catch (error) {
      console.error(error)

      alert(
        error.message ||
          'Não foi possível enviar a resposta.'
      )
    } finally {
      setSendingAdminReply(false)
    }
  }

  function renderAdminComment(
    comment,
    level = 0
  ) {
    const replies =
      visibleComments.filter(
        (item) =>
          item.parent_id ===
          comment.id
      )

    return (
      <div
        key={comment.id}
        className={`admin-comment-thread ${
          level > 0
            ? 'admin-comment-reply'
            : ''
        }`}
      >
        <article
          className={`admin-comment-card ${
            comment.status ===
            'offensive'
              ? 'admin-comment-offensive'
              : ''
          }`}
        >
          <div className="admin-comment-top">
            <div>
              <strong>
                {comment.author_name}
              </strong>

              <span>
                #{comment.id}
              </span>
            </div>

            <time>
              {new Date(
                `${comment.created_at.replace(
                  ' ',
                  'T'
                )}Z`
              ).toLocaleString(
                'pt-BR'
              )}
            </time>
          </div>

          <div className="admin-comment-location">
            {comment.chapter_slug
              ? `Capítulo: ${comment.chapter_slug}`
              : 'Comentário geral do mangá'}
          </div>

          <p className="admin-comment-content">
            {comment.content}
          </p>

          {comment.status ===
            'offensive' && (
            <div className="admin-comment-status">
              Comentário marcado como
              ofensivo
            </div>
          )}

          <div className="admin-comment-actions">
            <button
              type="button"
              onClick={() =>
                startAdminReply(
                  comment
                )
              }
            >
              Responder como
              administrador
            </button>

            {comment.status ===
            'offensive' ? (
              <button
                type="button"
                onClick={() =>
                  changeCommentStatus(
                    comment.id,
                    'visible'
                  )
                }
              >
                Remover marcação
              </button>
            ) : (
              <button
                type="button"
                onClick={() =>
                  changeCommentStatus(
                    comment.id,
                    'offensive'
                  )
                }
              >
                Marcar como ofensivo
              </button>
            )}

            <button
              type="button"
              className="admin-delete-button"
              onClick={() =>
                deleteComment(
                  comment.id
                )
              }
            >
              Excluir
            </button>
          </div>
        </article>

        {replies.length > 0 && (
          <div className="admin-comment-replies">
            {replies.map(
              (reply) =>
                renderAdminComment(
                  reply,
                  level + 1
                )
            )}
          </div>
        )}
      </div>
    )
  }

  const visibleComments =
    commentsMangaId === currentMangaId
      ? comments
      : []

  const rootComments =
    visibleComments.filter(
      (comment) =>
        comment.parent_id ===
          null ||
        comment.parent_id ===
          undefined
    )
  if (authenticated === null) {
    return (
      <main className="admin-page">
        <div className="admin-container">
          <section className="admin-section">
            <h2>Verificando acesso...</h2>
          </section>
        </div>
      </main>
    )
  }

  if (!authenticated) {
    return (
      <main className="admin-page">
        <div className="admin-container">
          <section className="admin-section">
            <h1>Área administrativa</h1>

            <p>
              Faça login para acessar o
              painel administrativo.
            </p>

            <form
              className="admin-reply-form"
              onSubmit={handleAdminLogin}
            >
              <div>
                <label htmlFor="admin-username">
                  Usuário
                </label>

                <input
                  id="admin-username"
                  type="text"
                  value={loginUsername}
                  onChange={(event) =>
                    setLoginUsername(
                      event.target.value
                    )
                  }
                  autoComplete="username"
                  disabled={loginLoading}
                />
              </div>

              <div>
                <label htmlFor="admin-password">
                  Senha
                </label>

                <input
                  id="admin-password"
                  type="password"
                  value={loginPassword}
                  onChange={(event) =>
                    setLoginPassword(
                      event.target.value
                    )
                  }
                  autoComplete="current-password"
                  disabled={loginLoading}
                />
              </div>

              {loginError && (
                <p className="comments-error">
                  {loginError}
                </p>
              )}

              <button
                type="submit"
                disabled={loginLoading}
              >
                {loginLoading
                  ? 'Entrando...'
                  : 'Entrar'}
              </button>
            </form>
          </section>
        </div>
      </main>
    )
  }
  return (
    <main className="admin-page">
      <div className="admin-container">
        <header className="admin-header">
          <h1>
            Painel Administrativo
          </h1>

          <p>
            Gerencie seus mangás,
            capítulos, páginas e
            comentários.
          </p>
        </header>

        <section className="admin-section">
          <h2>Meus mangás</h2>

          <div className="admin-manga-list">
            {mangas.map((manga) => (
              <article
                key={manga.id}
                className="admin-manga-card"
              >
                <div className="admin-manga-cover">
                  <img
                    src={manga.cover}
                    alt={`Capa de ${manga.title}`}
                  />
                </div>

                <div className="admin-manga-info">
                  <h3>
                    {manga.title}
                  </h3>

                  <p>
                    {manga.volume}
                  </p>

                  <p>
                    {manga.chapters.length}{' '}
                    {manga.chapters.length ===
                    1
                      ? 'capítulo'
                      : 'capítulos'}
                  </p>

                  <button
                    type="button"
                    onClick={() =>
                      setSelectedManga(
                        manga.id
                      )
                    }
                  >
                    Gerenciar
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>

        {currentManga && (
          <section className="admin-section">
            <div className="admin-section-header">
              <h2>
                Gerenciar:{' '}
                {currentManga.title}
              </h2>

              <button
                type="button"
                onClick={() => {
                  setSelectedManga(
                    null
                  )
                  setSelectedChapterSlug(
                    null
                  )
                  setSelectedFiles([])
                }}
              >
                Fechar
              </button>
            </div>

            <div className="admin-chapters">
              <div className="admin-chapters-header">
                <h3>Capítulos</h3>

                <button
                  type="button"
                  onClick={
                    createChapter
                  }
                >
                  + Novo capítulo
                </button>
              </div>

              {currentManga.chapters.map(
                (chapter) => (
                  <div
                    key={
                      chapter.slug
                    }
                    className="admin-chapter-card"
                  >
                    <div>
                      <strong>
                        {
                          chapter.title
                        }
                      </strong>

                      <span>
                        {
                          chapter.pages
                            .length
                        }{' '}
                        {chapter.pages
                          .length ===
                        1
                          ? 'página'
                          : 'páginas'}
                      </span>
                    </div>

                    <div className="admin-chapter-actions">
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedChapterSlug(
                            chapter.slug
                          )
                        }
                      >
                        Adicionar páginas
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          deleteChapter(
                            chapter
                          )
                        }
                      >
                        Excluir capítulo
                      </button>
                    </div>
                  </div>
                )
              )}
            </div>

            {selectedChapter && (
              <div className="admin-upload-section">
                <h3>
                  Adicionar páginas em{' '}
                  {
                    selectedChapter.title
                  }
                </h3>

                <input
                  type="file"
                  accept=".webp,.png,.jpg,.jpeg,image/webp,image/png,image/jpeg"
                  multiple
                  onChange={(event) =>
                    setSelectedFiles(
                      Array.from(
                        event.target.files ??
                          []
                      )
                    )
                  }
                />

                {selectedFiles.length >
                  0 && (
                  <p>
                    {
                      selectedFiles.length
                    }{' '}
                    arquivo(s)
                    selecionado(s)
                  </p>
                )}

                <button
                  type="button"
                  onClick={savePages}
                  disabled={
                    isUploadingPages ||
                    selectedFiles.length ===
                    0
                  }
                >
                  {isUploadingPages
                    ? 'Enviando…'
                    : 'Salvar páginas'}
                </button>

                {selectedChapter.pages.length >
                  0 && (
                  <div className="admin-existing-pages">
                    <h4>
                      Páginas existentes
                    </h4>

                    <div className="admin-page-list">
                      {selectedChapter.pages.map(
                        (pageUrl, index) => (
                          <div
                            key={pageUrl}
                            className="admin-page-item"
                            draggable="true"
                            onDragStart={() =>
                              handlePageDragStart(index)
                            }
                            onDragOver={handlePageDragOver}
                            onDrop={() =>
                              handlePageDrop(index)
                            }
                          >
                            <img
                             src={pageUrl}
                             alt={`Página ${index + 1}`}
                             className="admin-page-thumbnail"
                          />


                            <span>
                              Página{' '}
                              {index + 1}
                            </span>

                            <button
                              type="button"
                              onClick={() =>
                                deletePage(
                                  pageUrl
                                )
                              }
                            >
                              Excluir
                            </button>
                          </div>
                        )
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        <section className="admin-section admin-comments-section">
          <div className="admin-section-header">
            <div>
              <h2>
                Gerenciar comentários
              </h2>

              <p>
                Modere os comentários
                publicados pelos
                leitores.
              </p>
            </div>

            <button
              type="button"
              onClick={
                loadComments
              }
            >
              Atualizar
            </button>
          </div>

          {replyingTo && (
            <form
              className="admin-reply-form"
              onSubmit={
                sendAdminReply
              }
            >
              <div className="admin-reply-header">
                <div>
                  <strong>
                    Responder como
                    administrador
                  </strong>

                  <span>
                    Respondendo a{' '}
                    {
                      replyingTo.author_name
                    }
                  </span>
                </div>

                <button
                  type="button"
                  onClick={
                    cancelAdminReply
                  }
                >
                  Cancelar
                </button>
              </div>

              <textarea
                value={adminReply}
                onChange={(event) =>
                  setAdminReply(
                    event.target.value
                  )
                }
                placeholder="Escreva a resposta do administrador..."
                maxLength={2000}
                rows={5}
                disabled={
                  sendingAdminReply
                }
              />

              <button
                type="submit"
                disabled={
                  sendingAdminReply ||
                  !adminReply.trim()
                }
              >
                {sendingAdminReply
                  ? 'Enviando...'
                  : 'Publicar resposta'}
              </button>
            </form>
          )}

          {commentsLoading && (
            <p className="admin-comments-message">
              Carregando comentários...
            </p>
          )}

          {commentsError && (
            <p className="admin-comments-error">
              {commentsError}
            </p>
          )}

          {!commentsLoading &&
            !commentsError &&
            rootComments.length ===
              0 && (
              <p className="admin-comments-message">
                Nenhum comentário
                encontrado.
              </p>
            )}

          {!commentsLoading &&
            !commentsError &&
            rootComments.length >
              0 && (
              <div className="admin-comments-list">
                {rootComments.map(
                  (comment) =>
                    renderAdminComment(
                      comment
                    )
                )}
              </div>
            )}
        </section>
      </div>
    </main>
  )
}

export default AdminPage
