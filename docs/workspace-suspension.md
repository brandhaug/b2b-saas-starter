# Workspace suspension

A System Admin can suspend or reactivate a workspace from the admin page. Impersonated sessions cannot perform either action. Record an internal reason for each transition and a customer-safe explanation when suspending. Repeating the current state does not send another notice or create another audit event.

Suspension blocks ordinary workspace pages, mutations, REST requests, MCP tools, exports, and workspace deletion. Existing sessions and credentials remain stored but cannot access the workspace. Access to other workspaces continues. Reactivation restores ordinary access under the existing membership, credential, and billing rules; it does not restore revoked credentials or grant unpaid entitlements.

Owners and admins see the customer explanation and recovery controls permitted by their roles. Members see a notice to contact an owner. Owners can repair SSO. Owners and admins with the relevant permission can inspect and revoke credentials and reach billing recovery. New credentials cannot be created. Internal operator reasons are not customer-visible.

Billing continues unless separately changed. Suspension does not pause Stripe subscriptions, cancel renewal, create credit, or expire access automatically. Payment does not reactivate the workspace. Billing portal and cancellation remain available under normal billing permissions.

Ordinary queued notifications, digests, webhooks, and exports are suppressed when executed during suspension. Reactivation does not replay them. Security and billing messages, suspension notices, and cleanup continue. Existing export download links are blocked while suspended. Account deletion cannot remove a suspended workspace as a side effect.
