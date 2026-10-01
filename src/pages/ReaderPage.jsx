import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { useParams } from 'react-router-dom'
import { fetchMangaData } from '../mangaStorage'
import '../App.css'

const EMPTY_PAGES = []

function clampPageIndex(pageIndex, pageCount) {
  if (pageCount <= 0) {
    return 0
  }

  return Math.min(
    Math.max(pageIndex, 0),
    pageCount - 1
  )
}

function ReaderPage() {
  const { mangaSlug, chapterSlug } = useParams()

  const [mangas, setMangas] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [zoomPosition, setZoomPosition] = useState({
    mangaSlug,
    chapterSlug,
    value: 1,
  })
  const zoomMatchesRoute =
    zoomPosition.mangaSlug === mangaSlug &&
    zoomPosition.chapterSlug === chapterSlug
  const zoom = zoomMatchesRoute
    ? zoomPosition.value
    : 1
  const [isFullscreen, setIsFullscreen] = useState(false)
  const viewerRef = useRef(null)
  const pageViewportRef = useRef(null)

  useEffect(() => {
    async function loadMangas() {
      try {
        const data = await fetchMangaData()

        setMangas(data.mangas ?? [])
      } catch (err) {
        console.error(
          'Erro ao carregar mangás:',
          err
        )

        setError(
          'Não foi possível carregar o mangá.'
        )
      } finally {
        setLoading(false)
      }
    }

    loadMangas()
  }, [])

  const selectedManga =
    mangas.find(
      (item) => item.slug === mangaSlug
    )

  const selectedChapter =
    selectedManga?.chapters.find(
      (chapter) => chapter.slug === chapterSlug
    )

  const pages = selectedChapter?.pages ?? EMPTY_PAGES

  const totalPages = pages.length
  const [pagePosition, setPagePosition] = useState({
    chapterSlug,
    pages,
    index: 0,
  })
  const readerStateRef = useRef({
    chapterSlug,
    pages,
    pageCount: totalPages,
  })

  useLayoutEffect(() => {
    readerStateRef.current = {
      chapterSlug,
      pages,
      pageCount: totalPages,
    }
  }, [chapterSlug, pages, totalPages])

  const positionMatchesReader =
    pagePosition.chapterSlug === chapterSlug &&
    pagePosition.pages === pages
  const currentPage = positionMatchesReader
    ? clampPageIndex(pagePosition.index, totalPages)
    : 0
  const currentPageIndex = clampPageIndex(
    currentPage,
    totalPages
  )

  useLayoutEffect(() => {
    const viewport = pageViewportRef.current

    if (viewport) {
      viewport.scrollTop = 0
      viewport.scrollLeft = 0
    }
  }, [mangaSlug, chapterSlug, pages, currentPageIndex])

  const changePage = useCallback((step) => {
    setPagePosition((position) => {
      const {
        chapterSlug: currentChapterSlug,
        pages: currentPages,
        pageCount,
      } = readerStateRef.current

      if (pageCount === 0) {
        if (
          position.chapterSlug === currentChapterSlug &&
          position.pages === currentPages &&
          position.index === 0
        ) {
          return position
        }

        return {
          chapterSlug: currentChapterSlug,
          pages: currentPages,
          index: 0,
        }
      }

      const baseIndex =
        position.chapterSlug === currentChapterSlug &&
        position.pages === currentPages
          ? clampPageIndex(position.index, pageCount)
          : 0

      return {
        chapterSlug: currentChapterSlug,
        pages: currentPages,
        index: clampPageIndex(baseIndex + step, pageCount),
      }
    })
  }, [])

  const nextPage = useCallback(() => {
    changePage(1)
  }, [changePage])

  const previousPage = useCallback(() => {
    changePage(-1)
  }, [changePage])

  const updateZoom = useCallback((update) => {
    setZoomPosition((position) => {
      const currentValue =
        position.mangaSlug === mangaSlug &&
        position.chapterSlug === chapterSlug
          ? position.value
          : 1

      return {
        mangaSlug,
        chapterSlug,
        value: update(currentValue),
      }
    })
  }, [mangaSlug, chapterSlug])

  const increaseZoom = useCallback(() => {
    updateZoom((value) =>
      Math.min(Number((value + 0.25).toFixed(2)), 3)
    )
  }, [updateZoom])

  const decreaseZoom = useCallback(() => {
    updateZoom((value) =>
      Math.max(Number((value - 0.25).toFixed(2)), 0.5)
    )
  }, [updateZoom])

  const resetZoom = useCallback(() => {
    updateZoom(() => 1)
  }, [updateZoom])

  function handleWheel(event) {
    if (event.ctrlKey) {
      event.preventDefault()

      if (event.deltaY < 0) {
        increaseZoom()
      } else {
        decreaseZoom()
      }
    }
  }

  async function toggleFullscreen() {
    if (!document.fullscreenElement) {
      await viewerRef.current?.requestFullscreen()
      setIsFullscreen(true)
    } else {
      await document.exitFullscreen()
      setIsFullscreen(false)
    }
  }

  useEffect(() => {
    function handleKeyboard(event) {
      const target = event.target
      const isEditableTarget =
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.matches(
            'input, textarea, select, [role="textbox"]'
          ))

      if (
        !isEditableTarget &&
        event.key === 'ArrowRight'
      ) {
        nextPage()
      }

      if (
        !isEditableTarget &&
        event.key === 'ArrowLeft'
      ) {
        previousPage()
      }

      if (
        event.ctrlKey &&
        (event.key === '+' || event.key === '=')
      ) {
        event.preventDefault()
        increaseZoom()
      }

      if (event.ctrlKey && event.key === '-') {
        event.preventDefault()
        decreaseZoom()
      }

      if (event.ctrlKey && event.key === '0') {
        event.preventDefault()
        resetZoom()
      }

      if (event.key.toLowerCase() === 'f') {
        toggleFullscreen()
      }
    }

    window.addEventListener(
      'keydown',
      handleKeyboard
    )

    return () =>
      window.removeEventListener(
        'keydown',
        handleKeyboard
      )
  }, [nextPage, previousPage, increaseZoom, decreaseZoom, resetZoom])

  useEffect(() => {
    function fullscreenChanged() {
      setIsFullscreen(
        Boolean(document.fullscreenElement)
      )
    }

    document.addEventListener(
      'fullscreenchange',
      fullscreenChanged
    )

    return () =>
      document.removeEventListener(
        'fullscreenchange',
        fullscreenChanged
      )
  }, [])

  if (loading) {
    return (
      <div className="reader">
        <div className="empty-chapter">
          Carregando capítulo...
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="reader">
        <div className="empty-chapter">
          {error}
        </div>
      </div>
    )
  }

  if (!selectedManga || !selectedChapter) {
    return (
      <div className="reader">
        <div className="empty-chapter">
          Mangá ou capítulo não encontrado.
        </div>
      </div>
    )
  }

  return (
    <div
      className="reader"
      ref={viewerRef}
      onWheel={handleWheel}
    >
      <header className="reader-header">
        <a
          href={`/manga/${selectedManga.slug}`}
          className="back-to-manga"
        >
          ← Voltar para o mangá
        </a>

        <div className="reader-title">
          <strong>
            📖 MANGÁ NOSSO DE CADA DIA
          </strong>

          <span>
            {selectedManga.title} — {selectedChapter.title}
          </span>
        </div>

        <div className="chapter">
          {selectedChapter?.title ?? 'Capítulo'}
        </div>
      </header>

      <div className="toolbar">
        <button
          onClick={decreaseZoom}
          title="Diminuir zoom"
        >
          −
        </button>

        <button
          onClick={resetZoom}
          className="zoom-value"
          title="Voltar para 100%"
        >
          🔍 {Math.round(zoom * 100)}%
        </button>

        <button
          onClick={increaseZoom}
          title="Aumentar zoom"
        >
          +
        </button>

        <div className="toolbar-separator" />

        <button
          onClick={toggleFullscreen}
          title="Tela cheia"
        >
          {isFullscreen
            ? '⛶ Sair'
            : '⛶ Tela cheia'}
        </button>
      </div>

      <main className="reader-main">
        <button
          className="page-button left"
          onClick={previousPage}
          disabled={currentPageIndex === 0}
          aria-label="Página anterior"
        >
          ‹
        </button>

        <div className="page-viewport" ref={pageViewportRef}>
          {pages.length > 0 ? (
            <div
              className="page-container"
              style={{
                zoom,
              }}
            >
              <img
                src={pages[currentPageIndex]}
                alt={`Página ${currentPageIndex + 1}`}
                className="manga-page"
                draggable="false"
              />
            </div>
          ) : (
            <div className="empty-chapter">
              Este capítulo ainda não possui páginas.
            </div>
          )}
        </div>

        <button
          className="page-button right"
          onClick={nextPage}
          disabled={
            currentPageIndex >= totalPages - 1 ||
            totalPages === 0
          }
          aria-label="Próxima página"
        >
          ›
        </button>
      </main>

      <footer className="reader-footer">
        <button
          onClick={previousPage}
          disabled={currentPageIndex === 0}
        >
          ← Anterior
        </button>

        <span>
          {totalPages > 0
            ? `Página ${currentPageIndex + 1} / ${totalPages}`
            : 'Nenhuma página'}
        </span>

        <button
          onClick={nextPage}
          disabled={
            currentPageIndex >= totalPages - 1 ||
            totalPages === 0
          }
        >
          Próxima →
        </button>
      </footer>
    </div>
  )
}

export default ReaderPage
