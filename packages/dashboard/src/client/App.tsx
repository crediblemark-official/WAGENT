import React, { useState, useEffect } from 'react';
import { useWebSocket } from './hooks';

// ── Icons (inline SVG to avoid dependency issues) ──────────────

const Icons = {
  Chat: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
  ),
  Users: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
  ),
  Send: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
  ),
  BarChart: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
  ),
  Settings: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
  ),
  Clock: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
  ),
  Calendar: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
  ),
  Smartphone: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>
  ),
  Zap: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
  ),
};

// ── Pages ──────────────────────────────────────────────────────

import { ChatPage } from './pages/ChatPage';
import { ContactsPage } from './pages/ContactsPage';
import { BroadcastPage } from './pages/BroadcastPage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { SettingsPage } from './pages/SettingsPage';
import { SchedulePage } from './pages/SchedulePage';
import { NumbersPage } from './pages/NumbersPage';
import { KnowledgeBasePage } from './pages/KnowledgeBasePage';
import { FileManagerPage } from './pages/FileManagerPage';
import { ApprovalPage } from './pages/ApprovalPage';

type Page = 'chats' | 'contacts' | 'broadcast' | 'analytics' | 'settings' | 'schedule' | 'numbers' | 'knowledge-base' | 'files' | 'approval';

interface NavItem {
  id: Page;
  label: string;
  icon: React.ReactNode;
}

const IconsSmall = {
  Book: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
  ),
  File: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
  ),
  Check: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
  ),
};

const navItems: NavItem[] = [
  { id: 'chats', label: 'Percakapan', icon: <Icons.Chat /> },
  { id: 'contacts', label: 'Kontak', icon: <Icons.Users /> },
  { id: 'numbers', label: 'Nomor WA', icon: <Icons.Smartphone /> },
  { id: 'broadcast', label: 'Broadcast', icon: <Icons.Send /> },
  { id: 'schedule', label: 'Terjadwal', icon: <Icons.Clock /> },
  { id: 'knowledge-base', label: 'Knowledge Base', icon: <IconsSmall.Book /> },
  { id: 'files', label: 'File Manager', icon: <IconsSmall.File /> },
  { id: 'approval', label: 'Approval', icon: <IconsSmall.Check /> },
  { id: 'analytics', label: 'Analytics', icon: <Icons.BarChart /> },
  { id: 'settings', label: 'Pengaturan', icon: <Icons.Settings /> },
];

export function App() {
  const [currentPage, setCurrentPage] = useState<Page>('chats');
  const [connectionStatus, setConnectionStatus] = useState<string>('disconnected');
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const ws = useWebSocket();

  useEffect(() => {
    const unsub = ws.on('connection:status', (data) => {
      setConnectionStatus(data.status);
    });
    return () => unsub();
  }, [ws]);

  const renderPage = () => {
    switch (currentPage) {
      case 'chats':
        return <ChatPage ws={ws} selectedChatId={selectedChatId} onSelectChat={setSelectedChatId} />;
      case 'contacts':
        return <ContactsPage ws={ws} />;
      case 'broadcast':
        return <BroadcastPage ws={ws} />;
      case 'analytics':
        return <AnalyticsPage ws={ws} />;
      case 'numbers':
        return <NumbersPage ws={ws} />;
      case 'schedule':
        return <SchedulePage ws={ws} />;
      case 'knowledge-base':
        return <KnowledgeBasePage />;
      case 'files':
        return <FileManagerPage />;
      case 'approval':
        return <ApprovalPage />;
      case 'settings':
        return <SettingsPage />;
    }
  };

  const statusColor = {
    connected: '#22c55e',
    connecting: '#eab308',
    reconnecting: '#f97316',
    qr: '#a855f7',
    disconnected: '#ef4444',
  }[connectionStatus] || '#ef4444';

  return (
    <div style={styles.container}>
      {/* Sidebar */}
      <aside style={styles.sidebar}>
        <div style={styles.logo}>
          <Icons.Zap />
          <span style={styles.logoText}>WAGENT</span>
        </div>

        <nav style={styles.nav}>
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setCurrentPage(item.id)}
              style={{
                ...styles.navItem,
                ...(currentPage === item.id ? styles.navItemActive : {}),
              }}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div style={styles.statusBar}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: statusColor }} />
            <span style={{ fontSize: 12, color: '#94a3b8' }}>
              {connectionStatus === 'connected' ? 'Terkoneksi' :
               connectionStatus === 'qr' ? 'Scan QR' :
               connectionStatus === 'connecting' ? 'Menghubungkan...' :
               connectionStatus}
            </span>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main style={styles.main}>
        {renderPage()}
      </main>
    </div>
  );
}

// ── Styles ──────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    height: '100vh',
    overflow: 'hidden',
  },
  sidebar: {
    width: 240,
    backgroundColor: '#161822',
    borderRight: '1px solid #1e2030',
    display: 'flex',
    flexDirection: 'column',
    flexShrink: 0,
  },
  logo: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '20px 20px',
    borderBottom: '1px solid #1e2030',
    color: '#8b5cf6',
    fontWeight: 700,
    fontSize: 18,
  },
  logoText: {
    background: 'linear-gradient(135deg, #8b5cf6, #6366f1)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
  },
  nav: {
    flex: 1,
    padding: '12px 8px',
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  navItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '10px 14px',
    borderRadius: 8,
    border: 'none',
    background: 'transparent',
    color: '#94a3b8',
    fontSize: 14,
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    textAlign: 'left' as const,
    width: '100%',
  },
  navItemActive: {
    backgroundColor: 'rgba(139, 92, 246, 0.1)',
    color: '#8b5cf6',
    fontWeight: 500,
  },
  statusBar: {
    padding: '12px 16px',
    borderTop: '1px solid #1e2030',
  },
  main: {
    flex: 1,
    overflow: 'hidden',
  },
};
