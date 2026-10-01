const API_PREFIX = '/api'

export function apiUrl(path) {
  const normalizedPath = path.startsWith('/')
    ? path
    : `/${path}`

  return `${API_PREFIX}${normalizedPath}`
}
