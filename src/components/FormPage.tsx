import { useState } from 'react'
import { Alert, Button, Card } from './ui'

type FormState = {
  name: string
  focusArea: string
  audienceSize: string
  weeklyHours: string
  notes: string
}

const initialForm: FormState = {
  name: '',
  focusArea: 'digital-skills',
  audienceSize: '',
  weeklyHours: '',
  notes: '',
}

export function FormPage({ onDraftReady }: { onDraftReady: (summary: string) => void }) {
  const [form, setForm] = useState<FormState>(initialForm)
  const [error, setError] = useState('')
  const [warning, setWarning] = useState('')

  function update<K extends keyof FormState>(field: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  function handlePrepare() {
    if (!form.name || !form.audienceSize || !form.weeklyHours) {
      setError('Program name, audience size, and weekly hours are required.')
      setWarning('')
      return
    }

    const hours = Number(form.weeklyHours)
    setError('')

    if (hours > 18) {
      setWarning('High weekly hours can increase volunteer churn. Review plan capacity.')
    } else {
      setWarning('')
    }

    onDraftReady(`${form.name} for ${form.audienceSize} participants at ${hours} hrs/week`)
  }

  return (
    <Card title="Create intake draft">
      <form className="ui-form" onSubmit={(event) => event.preventDefault()}>
        <label>
          Program name
          <input value={form.name} onChange={(event) => update('name', event.target.value)} />
        </label>

        <label>
          Focus area
          <select
            value={form.focusArea}
            onChange={(event) => update('focusArea', event.target.value)}
          >
            <option value="digital-skills">Digital skills</option>
            <option value="workforce">Workforce readiness</option>
            <option value="wellness">Community wellness</option>
            <option value="youth">Youth enrichment</option>
          </select>
        </label>

        <div className="field-row">
          <label>
            Audience size
            <input
              type="number"
              min={1}
              value={form.audienceSize}
              onChange={(event) => update('audienceSize', event.target.value)}
            />
          </label>

          <label>
            Weekly hours
            <input
              type="number"
              min={1}
              value={form.weeklyHours}
              onChange={(event) => update('weeklyHours', event.target.value)}
            />
          </label>
        </div>

        <label>
          Notes
          <textarea
            rows={4}
            value={form.notes}
            onChange={(event) => update('notes', event.target.value)}
            placeholder="Describe constraints, outcomes, and dependencies..."
          />
        </label>

        {error ? <Alert tone="danger">{error}</Alert> : null}
        {warning ? <Alert tone="warning">{warning}</Alert> : null}

        <div className="form-actions">
          <Button kind="ghost" onClick={() => setForm(initialForm)}>
            Reset
          </Button>
          <Button onClick={handlePrepare}>Prepare summary</Button>
        </div>
      </form>
    </Card>
  )
}
