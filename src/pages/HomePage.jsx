import { useEffect, useState } from 'react'
import './HomePage.css'
import { fetchMangaData } from '../mangaStorage'

function HomePage() {
  const [mangas, setMangas] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    async function loadManga() {
      try {
        const data = await fetchMangaData()

        setMangas(data.mangas ?? [])
      } catch (err) {
        console.error(
          'Erro ao carregar mangá:',
          err
        )

        setError(
          'Não foi possível carregar o mangá.'
        )
      } finally {
        setLoading(false)
      }
    }

    loadManga()
  }, [])

  if (loading) {
    return (
      <div className="home-page">
        <main>
          <section className="home-section">
            <p>Carregando mangás...</p>
          </section>
        </main>
      </div>
    )
  }

  const manga = mangas[0]

  if (error || !manga) {
    return (
      <div className="home-page">
        <main>
          <section className="home-section">
            <p>
              {error ||
                'Nenhum mangá foi encontrado.'}
            </p>
          </section>
        </main>
      </div>
    )
  }

  const firstChapter = manga.chapters?.[0]

  return (
    <div className="home-page">
      <header className="home-header">
        <a href="/" className="home-logo">
          📖 MANGÁ NOSSO DE CADA DIA
        </a>

        <nav className="home-nav">
          <a href="/">Início</a>
          <a href="#mangas">Mangás</a>
          <a href="#">Sobre</a>
        </nav>

        <button className="home-search">
          🔎 Pesquisar
        </button>
      </header>

      <main>
        <section className="home-hero">
          <div className="hero-content">
            <p className="hero-label">
              MANGÁ EM DESTAQUE
            </p>

            <h1>{manga.title}</h1>

            <p className="hero-volume">
              {manga.volume}
            </p>

            <p className="hero-description">
              {manga.description}
            </p>

            <div className="hero-buttons">
              <a
                href={`/manga/${manga.slug}`}
                className="primary-button"
              >
                📖 Ver mangá
              </a>

              {firstChapter && (
                <a
                  href={`/manga/${manga.slug}/${firstChapter.slug}`}
                  className="secondary-button"
                >
                  ▶ Ler Capítulo {firstChapter.number}
                </a>
              )}
            </div>
          </div>

          <a
            href={`/manga/${manga.slug}`}
            className="hero-cover"
          >
            <img
              src={manga.cover}
              alt={`Capa de ${manga.title}`}
            />
          </a>
        </section>

        <section className="home-section">
          <div className="home-section-heading">
            <div>
              <p>DESCUBRA</p>
              <h2>Mangás</h2>
            </div>
          </div>

          {mangas.map((mangaItem) => {
            const chapter = mangaItem.chapters?.[0]
            const pageCount = mangaItem.chapters?.reduce(
              (total, item) => total + (item.pages?.length ?? 0),
              0
            ) ?? 0

            return (
              <article className="manga-card" key={mangaItem.id}>
                <a
                  href={`/manga/${mangaItem.slug}`}
                  className="manga-card-cover"
                >
                  <img
                    src={mangaItem.cover}
                    alt={`Capa de ${mangaItem.title}`}
                  />
                </a>

                <div className="manga-card-info">
                  <span className="card-label">
                    {mangaItem.volume?.toUpperCase()}
                  </span>

                  <h3>{mangaItem.title}</h3>
                  <p>{mangaItem.description}</p>

                  <div className="card-meta">
                    <span>
                      {chapter?.title ?? 'Nenhum capítulo'}
                    </span>
                    <span>{pageCount} páginas</span>
                  </div>

                  <a
                    href={`/manga/${mangaItem.slug}`}
                    className="card-button"
                  >
                    Ver mangá →
                  </a>
                </div>
              </article>
            )
          })}
        </section>

        <section className="home-ad">
          <span>ESPAÇO PARA PUBLICIDADE</span>
        </section>
      </main>

      <footer className="home-footer">
        <p>
          © 2026 MANGÁ NOSSO DE CADA DIA
        </p>

        <p>
          Site e mangá "Luz Entre Sombras" — Autor: Paulo Kazuo Ito
        </p>

        <p>
          © 2026 Paulo Kazuo Ito — Todos os direitos reservados.
        </p>
      </footer>
    </div>
  )
}

export default HomePage
