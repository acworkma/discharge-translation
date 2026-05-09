export type StatusTone = 'success' | 'warning' | 'danger' | 'info'

export type DashboardMetric = {
  label: string
  value: string
  detail: string
  tone: StatusTone
}

export type ProgramRecord = {
  id: string
  program: string
  coordinator: string
  seats: number
  enrolled: number
  status: StatusTone
  startDate: string
}

export const dashboardMetrics: DashboardMetric[] = [
  { label: 'Active programs', value: '18', detail: '+3 this month', tone: 'success' },
  { label: 'Waitlist requests', value: '46', detail: 'Needs triage', tone: 'warning' },
  { label: 'Avg satisfaction', value: '4.7/5', detail: 'From 312 surveys', tone: 'info' },
  { label: 'At-risk programs', value: '2', detail: 'Budget variance', tone: 'danger' },
]

export const upcomingTasks = [
  { title: 'Finalize spring mentor roster', due: 'Today', tone: 'warning' as const },
  { title: 'Publish volunteer orientation kit', due: 'Mon', tone: 'info' as const },
  { title: 'Confirm weekend venue insurance', due: 'Wed', tone: 'danger' as const },
  { title: 'Submit grant utilization update', due: 'Fri', tone: 'success' as const },
]

export const samplePrograms: ProgramRecord[] = [
  {
    id: 'PRG-101',
    program: 'Digital Literacy Basics',
    coordinator: 'A. Rivera',
    seats: 35,
    enrolled: 32,
    status: 'success',
    startDate: 'May 13',
  },
  {
    id: 'PRG-204',
    program: 'Community Garden Lab',
    coordinator: 'J. Patel',
    seats: 20,
    enrolled: 20,
    status: 'warning',
    startDate: 'May 16',
  },
  {
    id: 'PRG-319',
    program: 'Career Restart Circle',
    coordinator: 'M. Schultz',
    seats: 28,
    enrolled: 19,
    status: 'info',
    startDate: 'May 21',
  },
  {
    id: 'PRG-402',
    program: 'Youth Robotics Nights',
    coordinator: 'R. Kim',
    seats: 24,
    enrolled: 11,
    status: 'danger',
    startDate: 'May 29',
  },
]
