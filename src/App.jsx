import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import HomePage from './pages/HomePage'
import MangaPage from './pages/MangaPage'
import ReaderPage from './pages/ReaderPage'
import AdminPage from './pages/AdminPage'

function App() {
  return (
    <BrowserRouter>
      <Routes>

        <Route
          path="/"
          element={<HomePage />}
        />

        <Route
          path="/manga/:mangaSlug"
          element={<MangaPage />}
        />

        <Route
          path="/manga/:mangaSlug/:chapterSlug"
          element={<ReaderPage />}
        />

        <Route
          path="/admin"
          element={<AdminPage />}
        />

        <Route
          path="*"
          element={
            <Navigate
              to="/"
              replace
            />
          }
        />

      </Routes>
    </BrowserRouter>
  )
}

export default App
