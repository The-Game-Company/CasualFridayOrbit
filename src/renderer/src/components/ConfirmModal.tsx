import { useEffect, type ReactNode } from 'react'

interface Props {
  title: string
  confirmLabel?: string
  cancelLabel?: string
  /** style the confirm button as a destructive action */
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
  children: ReactNode
}

/** App-styled replacement for window.confirm — Enter confirms, Esc cancels. */
export function ConfirmModal({
  title,
  confirmLabel = 'Continue',
  cancelLabel = 'Cancel',
  danger,
  onConfirm,
  onCancel,
  children
}: Props): JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onCancel()
      } else if (e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        onConfirm()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onConfirm, onCancel])

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal confirm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span>{title}</span>
          <button onClick={onCancel}>✕</button>
        </div>
        <div className="confirm-body">{children}</div>
        <div className="confirm-actions">
          <button onClick={onCancel}>{cancelLabel}</button>
          <button className={danger ? 'danger' : 'primary'} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
