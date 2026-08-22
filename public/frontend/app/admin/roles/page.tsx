/**
 * CryptoExam Core — Admin Roles & Permissions
 * Wired to the live backend (/admin/roles): the real platform roles with
 * live assigned-user counts. No mock data.
 */
'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminApi, type AdminRole } from '@/lib/api/admin';
import {
  AdminPage, PageHeader, Card, CardGrid, Badge, Button,
  ErrorState, EmptyState,
} from '@/components/admin/AdminUI';

export default function AdminRolesPage() {
  const [roles, setRoles] = useState<AdminRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    adminApi.roles()
      .then((r) => setRoles(r.roles))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load roles'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  return (
    <AdminPage>
      <PageHeader
        eyebrow="Access control"
        title="Roles & Permissions"
        subtitle={
          loading
            ? 'Loading roles…'
            : 'Every role in the exam chain, with the number of accounts currently holding it. Roles are fixed in code — they are part of the security model, not configuration.'
        }
        actions={<Button onClick={load} disabled={loading}>Refresh</Button>}
      />

      {error && <ErrorState message={error} onRetry={load} />}

      {!loading && !error && roles.length === 0 && (
        <EmptyState title="No roles returned" hint="The backend responded, but with an empty role list." />
      )}

      {!error && (
        <CardGrid minColumn={300}>
          {roles.map((role) => (
            <Card key={role.role}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <strong style={{ fontSize: 14.5, color: 'var(--color-navy-900)' }}>{role.role}</strong>
                  <Badge tone={role.users > 0 ? 'info' : 'neutral'}>
                    {role.users} {role.users === 1 ? 'account' : 'accounts'}
                  </Badge>
                </div>
                <p style={{ fontSize: 12.5, lineHeight: 1.6, color: 'var(--color-navy-600)', margin: 0 }}>
                  {role.permissions}
                </p>
              </div>
            </Card>
          ))}
        </CardGrid>
      )}
    </AdminPage>
  );
}
