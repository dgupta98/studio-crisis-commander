import { createBrowserRouter, Navigate } from 'react-router-dom'
import { AppShell } from './shell/AppShell'
import LandingRoute from './routes/LandingRoute'
import DashboardRoute from './routes/DashboardRoute'
import MoviesRoute from './routes/MoviesRoute'
import MovieDetailRoute from './routes/MovieDetailRoute'
import AuditRoute from './routes/AuditRoute'
import SettingsRoute from './routes/SettingsRoute'

const shell = (el: JSX.Element) => <AppShell>{el}</AppShell>

export const router = createBrowserRouter([
  { path: '/', element: <LandingRoute /> },
  { path: '/dashboard', element: shell(<DashboardRoute />) },
  { path: '/movies', element: shell(<MoviesRoute />) },
  { path: '/movies/:filmId', element: shell(<MovieDetailRoute />) },
  { path: '/audit', element: shell(<AuditRoute />) },
  { path: '/settings', element: shell(<SettingsRoute />) },
  { path: '*', element: <Navigate to="/" replace /> },
])
