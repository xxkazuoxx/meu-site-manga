import { useEffect, useState } from 'react'
import { apiUrl } from '../api'
import './Comments.css'

function Comments({
  mangaId,
  chapterSlug = null,
}) {
  const [comments, setComments] = useState([])
  const [authorName, setAuthorName] = useState('')
  const [content, setContent] = useState('')
  const [replyingTo, setReplyingTo] = useState(null)
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  async function loadComments() {
    try {
      setLoading(true)
      setError('')

      let url =
        apiUrl(`/comments?mangaId=${encodeURIComponent(
          mangaId
        )}`)

      if (chapterSlug) {
        url += `&chapterSlug=${encodeURIComponent(
          chapterSlug
        )}`
      }

      const response = await fetch(url)

      if (!response.ok) {
        throw new Error(
          'Não foi possível carregar os comentários.'
        )
      }

      const data = await response.json()

      setComments(data.comments ?? [])
    } catch (err) {
      console.error(err)

      setError(
        'Não foi possível carregar os comentários.'
      )
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadComments()
  }, [mangaId, chapterSlug])

  async function handleSubmit(event) {
    event.preventDefault()

    if (
      !authorName.trim() ||
      !content.trim()
    ) {
      setError(
        'Digite seu nome e escreva um comentário.'
      )
      return
    }

    try {
      setSending(true)
      setError('')

      const response = await fetch(
        apiUrl('/comments'),
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            mangaId,
            chapterSlug,
            parentId:
              replyingTo?.id ?? null,
            authorName: authorName.trim(),
            content: content.trim(),
          }),
        }
      )

      const data = await response.json()

      if (!response.ok || !data.success) {
        throw new Error(
          data.error ||
            'Não foi possível publicar o comentário.'
        )
      }

      setComments((currentComments) => [
        ...currentComments,
        data.comment,
      ])

      setContent('')
      setReplyingTo(null)
    } catch (err) {
      console.error(err)

      setError(
        err.message ||
          'Não foi possível publicar o comentário.'
      )
    } finally {
      setSending(false)
    }
  }

  function handleReply(comment) {
    setReplyingTo(comment)
    setContent('')

    window.scrollTo({
      top:
        document.querySelector(
          '.comments-form'
        )?.getBoundingClientRect().top +
          window.scrollY -
          100,
      behavior: 'smooth',
    })
  }

  function cancelReply() {
    setReplyingTo(null)
    setContent('')
    setError('')
  }

  function getReplies(commentId) {
    return comments.filter(
      (comment) =>
        comment.parent_id === commentId
    )
  }

  function renderComment(comment, level = 0) {
    const replies = getReplies(comment.id)

    const isOffensive =
      comment.status === 'offensive'

    return (
      <div
        className={`comment-thread ${
          level > 0
            ? 'comment-reply'
            : ''
        }`}
        key={comment.id}
      >
        <article
          className={`comment-card ${
            isOffensive
              ? 'comment-offensive'
              : ''
          }`}
        >
          <div className="comment-top">
            <strong>
              {comment.author_name}
            </strong>

            <time>
              {(() => {
                const value =
                  comment.created_at

                const date =
                  value instanceof Date
                    ? value
                    : new Date(value)

                if (
                  Number.isNaN(
                    date.getTime()
                  )
                ) {
                  return ''
                }

                return date.toLocaleString(
                  'pt-BR',
                  {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  }
                )
              })()}
            </time>
          </div>

          <p className="comment-content">
            {comment.content}
          </p>

          {isOffensive && (
            <span className="comment-offensive-label">
              Comentário marcado como
              ofensivo
            </span>
          )}

          <button
            type="button"
            className="comment-reply-button"
            onClick={() =>
              handleReply(comment)
            }
          >
            Responder
          </button>
        </article>

        {replies.length > 0 && (
          <div className="comment-replies">
            {replies.map((reply) =>
              renderComment(
                reply,
                level + 1
              )
            )}
          </div>
        )}
      </div>
    )
  }

  const rootComments = comments.filter(
    (comment) =>
      comment.parent_id === null ||
      comment.parent_id === undefined
  )

  return (
    <section className="comments-section">
      <div className="comments-header">
        <h2>Comentários</h2>

        <span className="comments-count">
          {comments.length}{' '}
          {comments.length === 1
            ? 'comentário'
            : 'comentários'}
        </span>
      </div>

      <form
        className="comments-form"
        onSubmit={handleSubmit}
      >
        {replyingTo && (
          <div className="replying-box">
            <span>
              Respondendo a{' '}
              <strong>
                {replyingTo.author_name}
              </strong>
            </span>

            <button
              type="button"
              onClick={cancelReply}
            >
              Cancelar
            </button>
          </div>
        )}

        <label htmlFor="comment-author">
          Seu nome
        </label>

        <input
          id="comment-author"
          type="text"
          value={authorName}
          onChange={(event) =>
            setAuthorName(event.target.value)
          }
          placeholder="Digite seu nome"
          maxLength={50}
          disabled={sending}
        />

        <label htmlFor="comment-content">
          Seu comentário
        </label>

        <textarea
          id="comment-content"
          value={content}
          onChange={(event) =>
            setContent(event.target.value)
          }
          placeholder={
            replyingTo
              ? `Respondendo a ${replyingTo.author_name}...`
              : 'Escreva o que você achou da história...'
          }
          maxLength={2000}
          rows={5}
          disabled={sending}
        />

        {error && (
          <p className="comments-error">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={sending}
        >
          {sending
            ? 'Publicando...'
            : replyingTo
              ? 'Publicar resposta'
              : 'Publicar comentário'}
        </button>
      </form>

      <div className="comments-list">
        {loading ? (
          <p className="comments-message">
            Carregando comentários...
          </p>
        ) : rootComments.length === 0 ? (
          <p className="comments-message">
            Ainda não há comentários.
            Seja o primeiro a comentar!
          </p>
        ) : (
          rootComments.map((comment) =>
            renderComment(comment)
          )
        )}
      </div>
    </section>
  )
}

export default Comments
