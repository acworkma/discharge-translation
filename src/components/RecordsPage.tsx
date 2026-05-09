import { useState } from 'react'
import { samplePrograms } from '../data/sampleData'
import { Alert, Badge, Button, Card, EmptyState, LoadingState } from './ui'

type ViewState = 'ready' | 'loading' | 'empty' | 'error'

export function RecordsPage() {
  const [viewState, setViewState] = useState<ViewState>('ready')

  const rows = viewState === 'ready' ? samplePrograms : []

  return (
    <Card
      title="Program records"
      action={
        <div className="state-switcher">
          <Button kind="ghost" onClick={() => setViewState('ready')}>
            Data
          </Button>
          <Button kind="ghost" onClick={() => setViewState('loading')}>
            Loading
          </Button>
          <Button kind="ghost" onClick={() => setViewState('empty')}>
            Empty
          </Button>
          <Button kind="ghost" onClick={() => setViewState('error')}>
            Error
          </Button>
        </div>
      }
    >
      {viewState === 'loading' ? <LoadingState label="Syncing latest enrollment records…" /> : null}
      {viewState === 'error' ? (
        <Alert tone="danger">We couldn't load records right now. Try again in a minute.</Alert>
      ) : null}
      {viewState === 'empty' ? (
        <EmptyState title="No programs found" detail="Adjust filters or create a new intake." />
      ) : null}
      {viewState === 'ready' ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Program</th>
                <th>Coordinator</th>
                <th>Enrollment</th>
                <th>Start</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.program}</td>
                  <td>{row.coordinator}</td>
                  <td>
                    {row.enrolled}/{row.seats}
                  </td>
                  <td>{row.startDate}</td>
                  <td>
                    <Badge tone={row.status}>{row.status}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </Card>
  )
}
