const API_PREFIX =
  window.location.hostname === 'localhost' ||
  window.location.hostname === '127.0.0.1'
    ? 'http://localhost:3001/api'
    : 'https://meu-site-manga.onrender.com/api'

export function apiUrl(path) {
  const normalizedPath = path.startsWith('/')
    ? path
    : `/${path}`

  return `${API_PREFIX}${normalizedPath}`
}
