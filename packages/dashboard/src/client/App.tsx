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
  { id: 'numbers', label: 'WA & Tele Config', icon: <Icons.Smartphone /> },
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
  const [theme, setTheme] = useState<string>(() => localStorage.getItem('theme') || 'light');
  const ws = useWebSocket();

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => prev === 'light' ? 'dark' : 'light');
  };

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
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {connectionStatus === 'connected' ? 'Terkoneksi' :
               connectionStatus === 'qr' ? 'Scan QR' :
               connectionStatus === 'connecting' ? 'Menghubungkan...' :
               connectionStatus}
            </span>
          </div>

          <button 
            onClick={toggleTheme} 
            title={theme === 'light' ? 'Ubah ke Mode Gelap' : 'Ubah ke Mode Terang'}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 4,
              borderRadius: 4,
              color: 'var(--text-muted)',
              cursor: 'pointer',
            }}
          >
            {theme === 'light' ? (
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
            )}
          </button>
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
    backgroundColor: 'var(--bg-main)',
    fontFamily: 'Segoe UI, Helvetica Neue, Helvetica, Lucida Grande, Arial, Ubuntu, Cantarell, sans-serif',
  },
  sidebar: {
    width: 230,
    backgroundColor: 'var(--bg-sidebar)',
    borderRight: '1px solid var(--border-color)',
    display: 'flex',
    flexDirection: 'column',
    flexShrink: 0,
  },
  logo: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '16px 16px',
    borderBottom: '1px solid var(--border-color)',
    color: 'var(--text-active)',
    fontWeight: 700,
    fontSize: 16,
    letterSpacing: '0.5px',
  },
  logoText: {
    background: 'linear-gradient(135deg, #00a884, #25d366)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
  },
  nav: {
    flex: 1,
    padding: '8px 4px',
    display: 'flex',
    flexDirection: 'column',
    gap: 1,
    overflowY: 'auto',
  },
  navItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '8px 12px',
    borderRadius: 6,
    border: 'none',
    backgroundColor: 'transparent',
    color: 'var(--text-muted)',
    fontSize: 13,
    cursor: 'pointer',
    transition: 'all 0.1s ease',
    textAlign: 'left' as const,
    width: '100%',
  },
  navItemActive: {
    backgroundColor: 'var(--bg-active)',
    color: 'var(--text-active)',
    fontWeight: 600,
  },
  statusBar: {
    padding: '10px 14px',
    borderTop: '1px solid var(--border-color)',
    backgroundColor: 'var(--bg-sidebar)',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  main: {
    flex: 1,
    overflow: 'hidden',
    backgroundColor: 'var(--bg-main)',
  },
};
