import type { PropsWithChildren, ReactNode } from 'react'
import type { StatusTone } from '../data/sampleData'

type ButtonProps = PropsWithChildren<{
  kind?: 'primary' | 'ghost' | 'danger'
  onClick?: () => void
  type?: 'button' | 'submit'
  disabled?: boolean
}>

export function Button({ kind = 'primary', type = 'button', children, ...rest }: ButtonProps) {
  return (
    <button type={type} className={`ui-button ${kind}`} {...rest}>
      {children}
    </button>
  )
}

export function Badge({ tone, children }: PropsWithChildren<{ tone: StatusTone }>) {
  return <span className={`ui-badge ${tone}`}>{children}</span>
}

export function Card({ title, action, children }: PropsWithChildren<{ title: string; action?: ReactNode }>) {
  return (
    <section className="ui-card">
      <header className="ui-card-head">
        <h3>{title}</h3>
        {action}
      </header>
      {children}
    </section>
  )
}

export function Alert({ tone, children }: PropsWithChildren<{ tone: StatusTone }>) {
  return <div className={`ui-alert ${tone}`}>{children}</div>
}

export function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="ui-empty">
      <p>{title}</p>
      <span>{detail}</span>
    </div>
  )
}

export function LoadingState({ label = 'Loading content…' }: { label?: string }) {
  return (
    <div className="ui-loading" role="status" aria-live="polite">
      <span className="dot" />
      {label}
    </div>
  )
}

export function Modal({
  title,
  body,
  onClose,
  onConfirm,
}: {
  title: string
  body: string
  onClose: () => void
  onConfirm: () => void
}) {
  return (
    <div className="ui-modal-backdrop" role="presentation">
      <div className="ui-modal" role="dialog" aria-modal="true" aria-label={title}>
        <h3>{title}</h3>
        <p>{body}</p>
        <div className="ui-modal-actions">
          <Button kind="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onConfirm}>Confirm</Button>
        </div>
      </div>
    </div>
  )
}

export function Toast({
  tone,
  message,
  onClose,
}: {
  tone: StatusTone
  message: string
  onClose: () => void
}) {
  return (
    <div className={`ui-toast ${tone}`} role="status" aria-live="polite">
      <span>{message}</span>
      <button type="button" aria-label="Dismiss" onClick={onClose}>
        ×
      </button>
    </div>
  )
}
