import { Schema } from 'effect'
import { McpClientConnections } from './mcp-records'

export const loadMcpClientConnectionsServerFnResponse = McpClientConnections
export const revokeMcpClientServerFnResponse = Schema.Boolean
