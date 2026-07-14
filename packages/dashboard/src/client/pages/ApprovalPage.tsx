import React, { useState, useEffect, useCallback } from 'react';

interface PendingAction {
  id: string;
  type: 'broadcast' | 'scheduled' | 'workflow' | 'reminder';
  title: string;
  description: string;
  targetContact?: string;
  targetCount?: number;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
  createdBy: string;
}

// ── Icons ──────────────────────────────────────────────────────

const Icons = {
  Check: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
  ),
  X: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
  ),
  Clock: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
  ),
  Send: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
  ),
  Bell: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
  ),
  Refresh: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
  ),
};

// ── Styles ──────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  container: {
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: '#f8fafc',
  },
  header: {
    padding: '16px 24px',
    backgroundColor: '#fff',
    borderBottom: '1px solid #e2e8f0',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    fontSize: '20px',
    fontWeight: '600',
    color: '#1e293b',
    margin: 0,
  },
  actions: {
    display: 'flex',
    gap: '8px',
  },
  content: {
    flex: 1,
    overflow: 'auto',
    padding: '16px 24px',
  },
  tabs: {
    display: 'flex',
    gap: '4px',
    marginBottom: '16px',
  },
  tab: {
    padding: '8px 16px',
    borderRadius: '6px',
    border: 'none',
    fontSize: '14px',
    fontWeight: '500',
    cursor: 'pointer',
    backgroundColor: '#e2e8f0',
    color: '#64748b',
  },
  activeTab: {
    backgroundColor: '#3b82f6',
    color: '#fff',
  },
  actionList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  actionCard: {
    backgroundColor: '#fff',
    borderRadius: '8px',
    border: '1px solid #e2e8f0',
    padding: '16px',
  },
  actionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '8px',
  },
  actionTitle: {
    fontSize: '16px',
    fontWeight: '600',
    color: '#1e293b',
    margin: 0,
  },
  actionDescription: {
    fontSize: '14px',
    color: '#64748b',
    marginBottom: '12px',
  },
  actionMeta: {
    display: 'flex',
    gap: '16px',
    fontSize: '13px',
    color: '#94a3b8',
    marginBottom: '12px',
  },
  actionButtons: {
    display: 'flex',
    gap: '8px',
  },
  button: {
    padding: '8px 16px',
    borderRadius: '6px',
    border: 'none',
    fontSize: '14px',
    fontWeight: '500',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  approveButton: {
    backgroundColor: '#dcfce7',
    color: '#16a34a',
  },
  rejectButton: {
    backgroundColor: '#fee2e2',
    color: '#dc2626',
  },
  ghostButton: {
    backgroundColor: 'transparent',
    color: '#64748b',
  },
  badge: {
    padding: '4px 10px',
    borderRadius: '12px',
    fontSize: '12px',
    fontWeight: '500',
  },
  pendingBadge: {
    backgroundColor: '#fef3c7',
    color: '#d97706',
  },
  approvedBadge: {
    backgroundColor: '#dcfce7',
    color: '#16a34a',
  },
  rejectedBadge: {
    backgroundColor: '#fee2e2',
    color: '#dc2626',
  },
  empty: {
    textAlign: 'center',
    padding: '40px',
    color: '#94a3b8',
  },
};

// ── Component ──────────────────────────────────────────────────

export function ApprovalPage() {
  const [actions, setActions] = useState<PendingAction[]>([]);
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('pending');
  const [loading, setLoading] = useState(true);

  const fetchActions = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/approval?status=${filter}`);
      if (res.ok) {
        const data = await res.json();
        setActions(data.actions || []);
      }
    } catch (err) {
      console.error('Failed to fetch actions:', err);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    fetchActions();
  }, [fetchActions]);

  const handleApprove = async (action: PendingAction) => {
    try {
      const res = await fetch(`/api/approval/${action.id}/approve`, {
        method: 'POST',
      });
      if (res.ok) {
        fetchActions();
      }
    } catch (err) {
      console.error('Failed to approve:', err);
    }
  };

  const handleReject = async (action: PendingAction) => {
    try {
      const res = await fetch(`/api/approval/${action.id}/reject`, {
        method: 'POST',
      });
      if (res.ok) {
        fetchActions();
      }
    } catch (err) {
      console.error('Failed to reject:', err);
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'broadcast': return <Icons.Send />;
      case 'scheduled': return <Icons.Clock />;
      case 'workflow': return <Icons.Refresh />;
      case 'reminder': return <Icons.Bell />;
      default: return <Icons.Send />;
    }
  };

  const getBadgeStyle = (status: string) => {
    switch (status) {
      case 'approved': return styles.approvedBadge;
      case 'rejected': return styles.rejectedBadge;
      default: return styles.pendingBadge;
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.title}>✅ Approval Queue</h1>
        <div style={styles.actions}>
          <button
            style={{ ...styles.button, ...styles.ghostButton }}
            onClick={fetchActions}
          >
            <Icons.Refresh /> Refresh
          </button>
        </div>
      </div>

      <div style={styles.content}>
        <div style={styles.tabs}>
          {(['pending', 'all', 'approved', 'rejected'] as const).map((tab) => (
            <button
              key={tab}
              style={{
                ...styles.tab,
                ...(filter === tab ? styles.activeTab : {}),
              }}
              onClick={() => setFilter(tab)}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        <div style={styles.actionList}>
          {loading ? (
            <div style={styles.empty}>Loading...</div>
          ) : actions.length === 0 ? (
            <div style={styles.empty}>
              {filter === 'pending' ? 'Tidak ada yang perlu di-approve' : 'Tidak ada data'}
            </div>
          ) : (
            actions.map((action) => (
              <div key={action.id} style={styles.actionCard}>
                <div style={styles.actionHeader}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {getTypeIcon(action.type)}
                    <h3 style={styles.actionTitle}>{action.title}</h3>
                  </div>
                  <span style={{ ...styles.badge, ...getBadgeStyle(action.status) }}>
                    {action.status}
                  </span>
                </div>
                <p style={styles.actionDescription}>{action.description}</p>
                <div style={styles.actionMeta}>
                  <span>Type: {action.type}</span>
                  {action.targetContact && <span>Contact: {action.targetContact}</span>}
                  {action.targetCount && <span>Targets: {action.targetCount}</span>}
                  <span>Created: {new Date(action.createdAt).toLocaleString('id-ID')}</span>
                </div>
                {action.status === 'pending' && (
                  <div style={styles.actionButtons}>
                    <button
                      style={{ ...styles.button, ...styles.approveButton }}
                      onClick={() => handleApprove(action)}
                    >
                      <Icons.Check /> Approve
                    </button>
                    <button
                      style={{ ...styles.button, ...styles.rejectButton }}
                      onClick={() => handleReject(action)}
                    >
                      <Icons.X /> Reject
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
