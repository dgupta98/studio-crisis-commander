import { createBrowserRouter, Navigate } from 'react-router-dom'
import { AppShell } from './shell/AppShell'
import LandingRoute from './routes/LandingRoute'
import DashboardRoute from './routes/DashboardRoute'
import MoviesRoute from './routes/MoviesRoute'
import MovieDetailRoute from './routes/MovieDetailRoute'
import WhatNextRoute from './routes/WhatNextRoute'

const shell = (el: JSX.Element) => <AppShell>{el}</AppShell>

export const router = createBrowserRouter([
  { path: '/', element: <LandingRoute /> },
  { path: '/dashboard', element: shell(<DashboardRoute />) },
  { path: '/movies', element: shell(<MoviesRoute />) },
  { path: '/what-next', element: shell(<WhatNextRoute />) },
  { path: '/movies/:filmId', element: shell(<MovieDetailRoute />) },
  { path: '*', element: <Navigate to="/" replace /> },
])
