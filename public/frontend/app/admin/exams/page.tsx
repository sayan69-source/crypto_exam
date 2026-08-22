/**
 * CryptoExam Core — Admin Exam Lifecycle Manager
 * Wired to the live backend (/exams). No mock fixtures.
 */
'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminApi, type AdminExam } from '@/lib/api/admin';
import {
  AdminPage, PageHeader, Card, Badge, Button, Table,
  ErrorState, EmptyState, SkeletonRows, toneForStatus, cellNum, cellStrong,
} from '@/components/admin/AdminUI';

export default function AdminExamsPage() {
  const [exams, setExams] = useState<AdminExam[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    adminApi.exams()
      .then((r) => setExams(r.items))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load exams'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  return (
    <AdminPage>
      <PageHeader
        eyebrow="Lifecycle"
        title="Exam Lifecycle Manager"
        subtitle={
          loading
            ? 'Loading exams…'
            : `${exams.length} exam(s). Status moves DRAFT → GENERATING → PROOF_PENDING → LOCKED → LIVE → COMPLETED; a paper cannot go live before it is locked.`
        }
        actions={<Button onClick={load} disabled={loading}>Refresh</Button>}
      />

      {error && <ErrorState message={error} onRetry={load} />}

      {!error && (
        <Card flush>
          <Table head={['Exam', 'Body', 'Scheduled', 'Duration', 'Sets', 'Status']}>
            {loading && <SkeletonRows rows={5} cols={6} />}

            {!loading && exams.length === 0 && (
              <tr>
                <td colSpan={6} style={{ padding: 0, borderBottom: 0 }}>
                  <EmptyState
                    title="No exams yet"
                    hint="A setter creates one from the workbench; it appears here as soon as it exists."
                  />
                </td>
              </tr>
            )}

            {!loading && exams.map((exam) => (
              <tr key={exam.id}>
                <td className={cellStrong}>{exam.name}</td>
                <td>{exam.exam_body}</td>
                <td>
                  {new Date(exam.scheduled_at).toLocaleDateString('en-IN', {
                    day: '2-digit', month: 'short', year: 'numeric',
                  })}
                </td>
                <td className={cellNum}>{exam.duration_minutes} min</td>
                <td className={cellNum}>{exam.sets_count}</td>
                <td><Badge tone={toneForStatus(exam.status)} dot>{exam.status}</Badge></td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
    </AdminPage>
  );
}
