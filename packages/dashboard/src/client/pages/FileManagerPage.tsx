import React, { useState, useEffect, useCallback } from 'react';

interface FileInfo {
  path: string;
  name: string;
  size: number;
  isDirectory: boolean;
  modifiedAt: string;
  extension: string;
}

interface FileContent {
  path: string;
  content: string;
  size: number;
  modifiedAt: string;
}

// ── Icons ──────────────────────────────────────────────────────

const Icons = {
  File: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
  ),
  Folder: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
  ),
  Trash: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
  ),
  Upload: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
  ),
  Eye: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
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
    backgroundColor: 'var(--surface-2)',
  },
  header: {
    padding: '16px 24px',
    backgroundColor: 'var(--surface-bg)',
    borderBottom: '1px solid var(--surface-border)',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    fontSize: '20px',
    fontWeight: '600',
    color: 'var(--text-body)',
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
  fileList: {
    backgroundColor: 'var(--surface-bg)',
    borderRadius: '8px',
    border: '1px solid var(--surface-border)',
  },
  fileRow: {
    display: 'flex',
    alignItems: 'center',
    padding: '12px 16px',
    borderBottom: '1px solid var(--divider)',
    gap: '12px',
  },
  fileName: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    color: 'var(--text-body)',
    fontSize: '14px',
  },
  fileSize: {
    color: 'var(--text-subtle)',
    fontSize: '13px',
    width: '80px',
    textAlign: 'right',
  },
  fileDate: {
    color: 'var(--text-subtle)',
    fontSize: '13px',
    width: '120px',
  },
  fileActions: {
    display: 'flex',
    gap: '4px',
  },
  button: {
    padding: '6px 12px',
    borderRadius: '6px',
    border: 'none',
    fontSize: '13px',
    fontWeight: '500',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
  },
  primaryButton: {
    backgroundColor: '#3b82f6',
    color: '#fff',
  },
  dangerButton: {
    backgroundColor: '#fee2e2',
    color: '#dc2626',
  },
  ghostButton: {
    backgroundColor: 'transparent',
    color: 'var(--text-subtle)',
  },
  preview: {
    backgroundColor: 'var(--surface-bg)',
    borderRadius: '8px',
    border: '1px solid var(--surface-border)',
    marginTop: '16px',
    padding: '16px',
  },
  previewHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '12px',
  },
  previewContent: {
    fontFamily: 'monospace',
    fontSize: '13px',
    color: 'var(--text-subtle)',
    whiteSpace: 'pre-wrap',
    maxHeight: '400px',
    overflow: 'auto',
    backgroundColor: 'var(--surface-2)',
    padding: '12px',
    borderRadius: '6px',
  },
  empty: {
    textAlign: 'center',
    padding: '40px',
    color: 'var(--text-subtle)',
  },
  badge: {
    padding: '2px 8px',
    borderRadius: '12px',
    fontSize: '11px',
    fontWeight: '500',
  },
};

// ── Component ──────────────────────────────────────────────────

export function FileManagerPage() {
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [currentPath, setCurrentPath] = useState('.');
  const [selectedFile, setSelectedFile] = useState<FileContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  const fetchFiles = useCallback(async (path: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/files?path=${encodeURIComponent(path)}`);
      if (res.ok) {
        const data = await res.json();
        setFiles(data.files || []);
      }
    } catch (err) {
      console.error('Failed to fetch files:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFiles(currentPath);
  }, [currentPath, fetchFiles]);

  const handleView = async (file: FileInfo) => {
    if (file.isDirectory) {
      setCurrentPath(file.path);
      return;
    }

    try {
      const res = await fetch(`/api/files/read?path=${encodeURIComponent(file.path)}`);
      if (res.ok) {
        const data = await res.json();
        setSelectedFile(data);
      }
    } catch (err) {
      console.error('Failed to read file:', err);
    }
  };

  const handleDelete = async (file: FileInfo) => {
    if (!confirm(`Hapus "${file.name}"?`)) return;

    try {
      const res = await fetch(`/api/files?path=${encodeURIComponent(file.path)}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        fetchFiles(currentPath);
        if (selectedFile?.path === file.path) {
          setSelectedFile(null);
        }
      }
    } catch (err) {
      console.error('Failed to delete file:', err);
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    const formData = new FormData();
    formData.append('file', file);
    formData.append('path', currentPath);

    try {
      const res = await fetch('/api/files/upload', {
        method: 'POST',
        body: formData,
      });
      if (res.ok) {
        fetchFiles(currentPath);
      }
    } catch (err) {
      console.error('Failed to upload file:', err);
    } finally {
      setUploading(false);
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('id-ID', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.title}>📁 File Manager</h1>
        <div style={styles.actions}>
          <button
            style={{ ...styles.button, ...styles.ghostButton }}
            onClick={() => fetchFiles(currentPath)}
          >
            <Icons.Refresh /> Refresh
          </button>
          <label style={{ ...styles.button, ...styles.primaryButton, cursor: 'pointer' }}>
            <Icons.Upload /> Upload
            <input
              type="file"
              accept=".md,.txt,.csv,.json,.jsonl,.yaml,.yml"
              onChange={handleUpload}
              style={{ display: 'none' }}
              disabled={uploading}
            />
          </label>
        </div>
      </div>

      <div style={styles.content}>
        <div style={styles.fileList}>
          {loading ? (
            <div style={styles.empty}>Loading...</div>
          ) : files.length === 0 ? (
            <div style={styles.empty}>Tidak ada file</div>
          ) : (
            files.map((file) => (
              <div key={file.path} style={styles.fileRow}>
                <div style={styles.fileName}>
                  {file.isDirectory ? <Icons.Folder /> : <Icons.File />}
                  {file.name}
                  {file.extension && (
                    <span
                      style={{
                        ...styles.badge,
                        backgroundColor: '#e0e7ff',
                        color: '#4f46e5',
                      }}
                    >
                      {file.extension}
                    </span>
                  )}
                </div>
                <div style={styles.fileSize}>
                  {file.isDirectory ? '-' : formatSize(file.size)}
                </div>
                <div style={styles.fileDate}>{formatDate(file.modifiedAt)}</div>
                <div style={styles.fileActions}>
                  <button
                    style={{ ...styles.button, ...styles.ghostButton }}
                    onClick={() => handleView(file)}
                  >
                    <Icons.Eye />
                  </button>
                  {!file.isDirectory && (
                    <button
                      style={{ ...styles.button, ...styles.dangerButton }}
                      onClick={() => handleDelete(file)}
                    >
                      <Icons.Trash />
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {selectedFile && (
          <div style={styles.preview}>
            <div style={styles.previewHeader}>
              <strong>{selectedFile.path}</strong>
              <button
                style={{ ...styles.button, ...styles.ghostButton }}
                onClick={() => setSelectedFile(null)}
              >
                ✕
              </button>
            </div>
            <pre style={styles.previewContent}>{selectedFile.content}</pre>
          </div>
        )}
      </div>
    </div>
  );
}
