import type { PropsWithChildren } from 'react'
import { Button } from './ui'

export type PageKey = 'dashboard' | 'records' | 'form'

const navItems: Array<{ key: PageKey; label: string }> = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'records', label: 'Programs' },
  { key: 'form', label: 'New Intake' },
]

export function AppShell({
  page,
  onNavigate,
  children,
}: PropsWithChildren<{ page: PageKey; onNavigate: (page: PageKey) => void }>) {
  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <h1>Community Orbit</h1>
        <p>Program operations workspace</p>
        <nav>
          {navItems.map((item) => (
            <Button
              key={item.key}
              kind={page === item.key ? 'primary' : 'ghost'}
              onClick={() => onNavigate(item.key)}
            >
              {item.label}
            </Button>
          ))}
        </nav>
      </aside>
      <main className="app-main">
        <header className="app-topbar">
          <div>
            <h2>{navItems.find((item) => item.key === page)?.label}</h2>
            <p>Visually inspired by a dark, high-density dashboard design language.</p>
          </div>
          <Button kind="ghost">Export snapshot</Button>
        </header>
        {children}
      </main>
    </div>
  )
}
