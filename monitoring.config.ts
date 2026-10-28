import { type MonitoringConfig } from './infra/monitoring-settings.ts'

// Account schema, authorized destinations and watchdogs must be supplied first.
// See docs/monitoring.md. This file contains public settings only.
const monitoring: MonitoringConfig = { enabled: false }

export default monitoring
