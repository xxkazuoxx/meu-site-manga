import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { fetchMangaData } from '../mangaStorage'
import Comments from '../components/Comments'
import './MangaPage.css'

function MangaPage() {
  const { mangaSlug } = useParams()
  const [mangas, setMangas] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

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

  if (loading) {
    return (
      <main className="manga-page">
        <p>Carregando mangá...</p>
      </main>
    )
  }

  if (error) {
    return (
      <main className="manga-page">
        <p>{error}</p>
      </main>
    )
  }

  const selectedManga = mangas.find(
    (item) => item.slug === mangaSlug
  )

  if (!selectedManga) {
    return (
      <main className="manga-page">
        <p>Não foi possível encontrar o mangá.</p>
      </main>
    )
  }

  return (
    <main className="manga-page">
      <div className="manga-page-inner">
        <section className="manga-header">
          <div className="manga-cover">
            <img
              src={selectedManga.cover}
              alt={`Capa de ${selectedManga.title}`}
            />
          </div>

          <div className="manga-info">
            <h1>{selectedManga.title}</h1>

            <p className="manga-volume">
              {selectedManga.volume}
            </p>

            <p className="manga-description">
              {selectedManga.description}
            </p>
          </div>
        </section>

        <section className="chapters-section">
          <div className="chapters-header">
            <h2>Capítulos</h2>

            <span>
              {selectedManga.chapters.length}{' '}
              {selectedManga.chapters.length === 1
                ? 'capítulo'
                : 'capítulos'}
            </span>
          </div>

          <div className="chapters-list">
            {selectedManga.chapters.map(
              (chapter) => (
                <Link
                  key={chapter.slug}
                  to={`/manga/${selectedManga.slug}/${chapter.slug}`}
                  className="chapter-card"
                >
                  <div className="chapter-info">
                    <h3>
                      {chapter.title}
                    </h3>

                    <span>
                      {chapter.pages.length}{' '}
                      {chapter.pages.length === 1
                        ? 'página'
                        : 'páginas'}
                    </span>
                  </div>

                  <span className="chapter-arrow">
                    →
                  </span>
                </Link>
              )
            )}
          </div>
        </section>

        <Comments
          mangaId={selectedManga.id}
        />
      </div>
    </main>
  )
}

export default MangaPage
