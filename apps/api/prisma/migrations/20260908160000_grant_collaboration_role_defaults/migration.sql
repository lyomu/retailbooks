-- Phase 11 follow-up: give the remaining system roles the collaboration defaults.
--
-- Phase 11 introduced the collaboration permission keys but granted them only to ADMIN, ACCOUNTANT
-- and SALES. Rolling the Comments/Files/Activity panel out to every transaction-detail surface made
-- that gap visible: PURCHASES owns bills, expenses, purchase orders, vendor credits and payments
-- made; INVENTORY_MANAGER owns adjustments and movements; PROJECT_MANAGER owns projects and time
-- entries -- and none of them could comment on or attach to their own documents. VIEWER gets the
-- timeline alone, matching its read-only remit.
--
-- Customer visibility is deliberately not granted: none of these roles' targets are
-- customer-eligible, and the target registry refuses a customer-visible comment on them anyway.
--
-- Roles are seeded per organization, so this backfills the rows that `seedSystemRoles` will now
-- create for new tenants. It touches only system roles, never a custom role an administrator built,
-- and `ON CONFLICT DO NOTHING` keeps it a no-op on any organization that already has the grant.

INSERT INTO role_permissions (role_id, permission_key)
SELECT roles.id, grants.permission_key
FROM roles
CROSS JOIN LATERAL (
  VALUES
    ('PURCHASES', 'collaboration.comments.create'),
    ('PURCHASES', 'collaboration.attachments.upload'),
    ('PURCHASES', 'collaboration.activity.view'),
    ('INVENTORY_MANAGER', 'collaboration.comments.create'),
    ('INVENTORY_MANAGER', 'collaboration.attachments.upload'),
    ('INVENTORY_MANAGER', 'collaboration.activity.view'),
    ('PROJECT_MANAGER', 'collaboration.comments.create'),
    ('PROJECT_MANAGER', 'collaboration.attachments.upload'),
    ('PROJECT_MANAGER', 'collaboration.activity.view'),
    ('VIEWER', 'collaboration.activity.view')
) AS grants (role_key, permission_key)
WHERE roles.is_system = true AND roles.key = grants.role_key
ON CONFLICT (role_id, permission_key) DO NOTHING;
