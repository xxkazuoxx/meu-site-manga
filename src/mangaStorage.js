import { apiUrl } from './api'

export async function fetchMangaData() {
  const response = await fetch(apiUrl('/mangas'))
  if (!response.ok) {
    throw new Error(
      'Não foi possível carregar os mangás.'
    )
  }

  return response.json()
}
