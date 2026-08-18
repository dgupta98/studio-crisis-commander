import { createBrowserRouter, Navigate } from 'react-router-dom'
import LandingRoute from './routes/LandingRoute'
import DashboardRoute from './routes/DashboardRoute'
import MoviesRoute from './routes/MoviesRoute'
import MovieDetailRoute from './routes/MovieDetailRoute'
import AuditRoute from './routes/AuditRoute'
import SettingsRoute from './routes/SettingsRoute'

export const router = createBrowserRouter([
  { path: '/', element: <LandingRoute /> },
  { path: '/dashboard', element: <DashboardRoute /> },
  { path: '/movies', element: <MoviesRoute /> },
  { path: '/movies/:filmId', element: <MovieDetailRoute /> },
  { path: '/audit', element: <AuditRoute /> },
  { path: '/settings', element: <SettingsRoute /> },
  { path: '*', element: <Navigate to="/" replace /> },
])
