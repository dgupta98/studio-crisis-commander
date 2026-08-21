import { NavLink } from 'react-router-dom'

const LINKS = [
  { to: '/dashboard', label: 'Dashboard', icon: '◉' },
  { to: '/movies', label: 'Movies', icon: '▤' },
  { to: '/audit', label: 'Audit', icon: '◈' },
  { to: '/settings', label: 'Settings', icon: '⚙' },
]

export function LeftNav() {
  return (
    <nav aria-label="Primary" className="flex h-full w-56 flex-col border-r border-line bg-card">
      <NavLink to="/" className="flex items-center gap-2 border-b border-line px-4 py-4 text-sm font-display tracking-tight">
        <span className="text-accent">SCC</span>
        <span className="text-ink-soft">/ Crisis Commander</span>
      </NavLink>
      <ul className="flex-1 py-4">
        {LINKS.map((link) => (
          <li key={link.to}>
            <NavLink
              to={link.to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-2 text-sm ${
                  isActive ? 'bg-card-alt text-ink border-l-2 border-accent' : 'text-ink-soft hover:text-ink'
                }`
              }
            >
              <span aria-hidden className="w-4 text-center opacity-70">{link.icon}</span>
              {link.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
