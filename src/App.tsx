import { useEffect, useState } from 'react'
import { AppShell, type PageKey } from './components/AppShell'
import { DashboardPage } from './components/DashboardPage'
import { FormPage } from './components/FormPage'
import { RecordsPage } from './components/RecordsPage'
import { Modal, Toast } from './components/ui'

function App() {
  const [page, setPage] = useState<PageKey>('dashboard')
  const [pendingSummary, setPendingSummary] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [toast, setToast] = useState<{ tone: 'success' | 'warning'; message: string } | null>(null)

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 3500)
    return () => window.clearTimeout(timer)
  }, [toast])

  function handleDraftReady(summary: string) {
    setPendingSummary(summary)
    setModalOpen(true)
  }

  function confirmDraft() {
    setModalOpen(false)
    setToast({ tone: 'success', message: `Draft saved: ${pendingSummary}` })
    setPage('dashboard')
  }

  return (
    <>
      <AppShell page={page} onNavigate={setPage}>
        {page === 'dashboard' ? <DashboardPage /> : null}
        {page === 'records' ? <RecordsPage /> : null}
        {page === 'form' ? <FormPage onDraftReady={handleDraftReady} /> : null}
      </AppShell>

      {modalOpen ? (
        <Modal
          title="Confirm intake draft"
          body={pendingSummary}
          onClose={() => setModalOpen(false)}
          onConfirm={confirmDraft}
        />
      ) : null}

      {toast ? <Toast tone={toast.tone} message={toast.message} onClose={() => setToast(null)} /> : null}
    </>
  )
}

export default App
