/**
 * CryptoExam Core — Admin Roles & Permissions
 * Wired to the live backend (/admin/roles): the real platform roles with
 * live assigned-user counts. No mock data.
 */
'use client';

import { useEffect, useState } from 'react';
import { adminApi, type AdminRole } from '@/lib/api/admin';

export default function AdminRolesPage() {
  const [roles, setRoles] = useState<AdminRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    adminApi.roles()
      .then((r) => { if (alive) setRoles(r.roles); })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : 'Failed to load roles'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  return (
    <div style={{ animation: 'fadeIn 300ms ease forwards' }}>
      <h1 style={{ fontSize: 22, color: 'var(--color-navy-900)', marginBottom: 8 }}>Roles &amp; Permissions</h1>
      <p style={{ fontSize: 13, color: 'var(--color-navy-500)', marginBottom: 24 }}>
        {loading ? 'Loading roles…' : 'Live platform roles with assigned-user counts.'}
      </p>

      {error && (
        <div style={{ padding: 16, border: '1px solid rgba(200,32,32,0.35)', background: 'rgba(200,32,32,0.06)', borderRadius: 12, color: 'var(--color-danger)' }}>{error}</div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
        {roles.map((role) => (
          <div key={role.role} style={{ background: '#fff', border: '1px solid var(--border-soft)', borderRadius: 12, padding: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-navy-900)' }}>{role.role}</span>
            <span style={{ fontSize: 12, color: 'var(--color-navy-600)' }}>{role.permissions}</span>
            <span style={{ fontSize: 11, color: 'var(--color-navy-400)' }}>{role.users} user(s) assigned</span>
          </div>
        ))}
      </div>
    </div>
  );
}
