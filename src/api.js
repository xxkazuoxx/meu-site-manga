const API_PREFIX = 'https://luz-entre-sombras-server.onrender.com/api'

export function apiUrl(path) {
  const normalizedPath = path.startsWith('/')
    ? path
    : `/${path}`

  return `${API_PREFIX}${normalizedPath}`
}
