import { NavLink } from 'react-router-dom'
import { BrandMark } from '@/components/BrandMark'

const LINKS = [
  { to: '/dashboard', label: 'Dashboard', icon: '◉' },
  { to: '/movies', label: 'Movies', icon: '▤' },
  { to: '/what-next', label: 'What Next?', icon: '◌' },
]

export function LeftNav() {
  return (
    <nav aria-label="Primary" className="flex h-full w-64 flex-col border-r border-line bg-card">
      <div className="border-b border-line px-5 py-5">
        <BrandMark />
      </div>
      <ul className="flex-1 py-4">
        {LINKS.map((link) => (
          <li key={link.to}>
            <NavLink
              to={link.to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-5 py-3 text-base ${
                  isActive ? 'bg-card-alt text-ink border-l-2 border-accent' : 'text-ink-soft hover:text-ink'
                }`
              }
            >
              <span aria-hidden className="w-5 text-center text-lg opacity-80">{link.icon}</span>
              {link.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
