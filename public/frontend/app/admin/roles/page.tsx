'use client';

const ROLES = [
  { name: 'Super Admin', users: 2, permissions: 'Full access', badge: '' },
  { name: 'Exam Controller', users: 5, permissions: 'Exam lifecycle, Emergency actions', badge: '' },
  { name: 'Center Coordinator', users: 48, permissions: 'Center management, Node monitoring', badge: '' },
  { name: 'Blockchain Auditor', users: 3, permissions: 'Read-only blockchain, Integrity checks', badge: '' },
  { name: 'Setter Lead', users: 12, permissions: 'Exam creation, ZK proof generation', badge: '' },
  { name: 'Viewer', users: 8, permissions: 'Read-only dashboard', badge: '' },
];

export default function AdminRolesPage() {
  return (
    <div style={{ animation: 'fadeIn 300ms ease forwards' }}>
      <h1 style={{ fontSize: 22, color: 'white', marginBottom: 24 }}>Roles & Permissions</h1>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
        {ROLES.map(role => (
          <div key={role.name} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--color-navy-700)', borderRadius: 12, padding: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 20 }}>{role.badge}</span>
              <span style={{ fontSize: 15, fontWeight: 600, color: 'white' }}>{role.name}</span>
            </div>
            <span style={{ fontSize: 12, color: 'var(--color-navy-300)' }}>{role.permissions}</span>
            <span style={{ fontSize: 11, color: 'var(--color-navy-400)' }}>{role.users} users assigned</span>
          </div>
        ))}
      </div>
    </div>
  );
}
