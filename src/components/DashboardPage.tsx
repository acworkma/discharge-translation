import { dashboardMetrics, upcomingTasks } from '../data/sampleData'
import { Badge, Card } from './ui'

export function DashboardPage() {
  return (
    <section className="page-grid">
      <Card title="Program pulse">
        <div className="metric-grid">
          {dashboardMetrics.map((metric) => (
            <article key={metric.label} className="metric-tile">
              <span>{metric.label}</span>
              <strong>{metric.value}</strong>
              <Badge tone={metric.tone}>{metric.detail}</Badge>
            </article>
          ))}
        </div>
      </Card>

      <Card title="Upcoming actions">
        <ul className="task-list">
          {upcomingTasks.map((task) => (
            <li key={task.title}>
              <div>
                <p>{task.title}</p>
                <small>Due: {task.due}</small>
              </div>
              <Badge tone={task.tone}>{task.tone}</Badge>
            </li>
          ))}
        </ul>
      </Card>
    </section>
  )
}
