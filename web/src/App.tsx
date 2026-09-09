import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { ImagesPage } from './pages/images/ImagesPage'

export function App() {
  return (
    <BrowserRouter>
      <div className="flex min-h-screen flex-col">
        <header className="h-14 border-b bg-background">
          <div className="mx-auto flex h-full max-w-6xl items-center px-4">
            <span className="text-sm font-semibold">smartimg</span>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
          <Routes>
            <Route path="/" element={<Navigate to="/images" replace />} />
            <Route path="/images" element={<ImagesPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}
