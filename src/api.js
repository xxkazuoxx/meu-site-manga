const API_PREFIX = 'https://meu-site-manga.onrender.com/api'

export function apiUrl(path) {
  const normalizedPath = path.startsWith('/')
    ? path
    : `/${path}`

  return `${API_PREFIX}${normalizedPath}`
}
