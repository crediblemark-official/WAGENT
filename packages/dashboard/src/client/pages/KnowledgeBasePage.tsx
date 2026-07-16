import React, { useState, useEffect, useCallback } from 'react';

interface KnowledgeEntry {
  id: string;
  category: string;
  question: string;
  answer: string;
  keywords: string[];
  tags: string[];
  priority: number;
  createdAt: string;
  updatedAt: string;
}

interface KnowledgeSearchResult {
  entry: KnowledgeEntry;
  score: number;
  matchedOn: string;
}

// ── Icons ──────────────────────────────────────────────────────

const Icons = {
  Search: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
  ),
  Plus: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
  ),
  Trash: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
  ),
  Edit: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
  ),
  Book: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
  ),
  Filter: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
  ),
};

// ── Styles ──────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  container: {
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: 'var(--input-bg)',
  },
  header: {
    padding: '20px 24px',
    borderBottom: '1px solid var(--surface-border)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    color: 'var(--text-heading)',
    fontSize: 20,
    fontWeight: 600,
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },
  searchBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'var(--surface-bg)',
    border: '1px solid var(--hover-bg)',
    borderRadius: 8,
    padding: '8px 12px',
    width: 240,
  },
  searchInput: {
    background: 'transparent',
    border: 'none',
    color: 'var(--text-body)',
    fontSize: 13,
    outline: 'none',
    width: '100%',
    fontFamily: 'inherit',
  },
  addButton: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '8px 16px',
    backgroundColor: '#8b5cf6',
    color: 'white',
    border: 'none',
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    fontFamily: 'inherit',
  },
  filterBar: {
    padding: '12px 24px',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    borderBottom: '1px solid var(--surface-border)',
  },
  filterChip: {
    padding: '4px 12px',
    borderRadius: 16,
    fontSize: 12,
    border: '1px solid var(--hover-bg)',
    background: 'transparent',
    color: 'var(--text-subtle)',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    fontFamily: 'inherit',
  },
  filterChipActive: {
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
    borderColor: '#8b5cf6',
    color: '#8b5cf6',
  },
  content: {
    flex: 1,
    overflow: 'auto',
    padding: '16px 24px',
  },
  entryCard: {
    backgroundColor: 'var(--surface-bg)',
    border: '1px solid var(--hover-bg)',
    borderRadius: 10,
    padding: '16px 20px',
    marginBottom: 12,
    transition: 'all 0.15s ease',
    cursor: 'pointer',
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  cardQuestion: {
    color: 'var(--text-body)',
    fontSize: 14,
    fontWeight: 600,
    flex: 1,
    marginRight: 12,
  },
  cardActions: {
    display: 'flex',
    gap: 6,
    opacity: 0,
    transition: 'opacity 0.15s ease',
  },
  cardMeta: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
    flexWrap: 'wrap',
  },
  categoryBadge: {
    padding: '2px 8px',
    borderRadius: 4,
    fontSize: 11,
    fontWeight: 600,
    backgroundColor: 'rgba(99, 102, 241, 0.15)',
    color: '#818cf8',
  },
  priorityStars: {
    fontSize: 11,
    color: '#eab308',
  },
  tagBadge: {
    padding: '2px 6px',
    borderRadius: 4,
    fontSize: 11,
    backgroundColor: 'rgba(34, 197, 94, 0.1)',
    color: '#4ade80',
  },
  cardAnswer: {
    color: 'var(--text-subtle)',
    fontSize: 13,
    lineHeight: 1.6,
    maxHeight: 60,
    overflow: 'hidden',
    position: 'relative',
  },
  cardAnswerExpanded: {
    maxHeight: 'none',
  },
  expandFade: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 24,
    background: 'linear-gradient(transparent, var(--surface-bg))',
  },
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 60,
    color: 'var(--text-subtle)',
    textAlign: 'center',
  },
  emptyIcon: {
    opacity: 0.3,
    marginBottom: 16,
  },
  // Modal styles
  modalOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
  },
  modal: {
    backgroundColor: 'var(--surface-bg)',
    border: '1px solid var(--hover-bg)',
    borderRadius: 14,
    padding: 28,
    width: 560,
    maxHeight: '80vh',
    overflow: 'auto',
  },
  modalTitle: {
    color: 'var(--text-heading)',
    fontSize: 18,
    fontWeight: 600,
    marginBottom: 20,
  },
  formGroup: {
    marginBottom: 16,
  },
  formLabel: {
    color: 'var(--text-subtle)',
    fontSize: 12,
    fontWeight: 600,
    marginBottom: 6,
    display: 'block',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
  },
  formInput: {
    width: '100%',
    padding: '10px 12px',
    backgroundColor: 'var(--input-bg)',
    border: '1px solid var(--hover-bg)',
    borderRadius: 8,
    color: 'var(--text-body)',
    fontSize: 13,
    outline: 'none',
    fontFamily: 'inherit',
    boxSizing: 'border-box',
  },
  formTextarea: {
    width: '100%',
    padding: '10px 12px',
    backgroundColor: 'var(--input-bg)',
    border: '1px solid var(--hover-bg)',
    borderRadius: 8,
    color: 'var(--text-body)',
    fontSize: 13,
    outline: 'none',
    fontFamily: 'inherit',
    minHeight: 100,
    resize: 'vertical',
    boxSizing: 'border-box',
  },
  modalActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 20,
  },
  cancelButton: {
    padding: '8px 16px',
    backgroundColor: 'transparent',
    border: '1px solid var(--hover-bg)',
    borderRadius: 8,
    color: 'var(--text-subtle)',
    cursor: 'pointer',
    fontSize: 13,
    fontFamily: 'inherit',
  },
  saveButton: {
    padding: '8px 20px',
    backgroundColor: '#8b5cf6',
    color: 'white',
    border: 'none',
    borderRadius: 8,
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 600,
    fontFamily: 'inherit',
  },
  keywordInput: {
    display: 'flex',
    gap: 8,
    marginBottom: 8,
  },
  keywordTag: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '2px 8px',
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
    color: '#a78bfa',
    borderRadius: 4,
    fontSize: 12,
    marginRight: 4,
    marginBottom: 4,
  },
  keywordRemove: {
    cursor: 'pointer',
    opacity: 0.6,
    fontSize: 14,
    lineHeight: '14px',
  },
  keywordsContainer: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 4,
  },
  resultBadge: {
    padding: '2px 6px',
    borderRadius: 4,
    fontSize: 11,
    backgroundColor: 'rgba(251, 191, 36, 0.15)',
    color: '#fbbf24',
  },
};

export function KnowledgeBasePage() {
  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<{id: string; score: number}[] | null>(null);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editingEntry, setEditingEntry] = useState<KnowledgeEntry | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Form state
  const [formCategory, setFormCategory] = useState('general');
  const [formQuestion, setFormQuestion] = useState('');
  const [formAnswer, setFormAnswer] = useState('');
  const [formKeywords, setFormKeywords] = useState<string[]>([]);
  const [formKeywordInput, setFormKeywordInput] = useState('');
  const [formTags, setFormTags] = useState<string[]>([]);
  const [formTagInput, setFormTagInput] = useState('');
  const [formPriority, setFormPriority] = useState(0);

  const fetchEntries = useCallback(async () => {
    try {
      const baseUrl = window.location.origin;
      const url = activeCategory
        ? `${baseUrl}/api/knowledge-base?category=${encodeURIComponent(activeCategory)}`
        : `${baseUrl}/api/knowledge-base`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setEntries(data.entries || []);
      }
    } catch { /* ignore */ }
  }, [activeCategory]);

  const fetchCategories = useCallback(async () => {
    try {
      const res = await fetch(`${window.location.origin}/api/knowledge-base/categories`);
      if (res.ok) {
        const data = await res.json();
        setCategories(data.categories || []);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    Promise.all([
      fetchEntries(),
      fetchCategories(),
    ]).finally(() => setLoading(false));
  }, [fetchEntries, fetchCategories]);

  // Search handler with debounce
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults(null);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`${window.location.origin}/api/knowledge-base/search?q=${encodeURIComponent(searchQuery)}`);
        if (res.ok) {
          const data = await res.json();
          setSearchResults(data.results?.map((r: any) => ({ id: r.entry.id, score: r.score })) || []);
        }
      } catch { /* ignore */ }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const openAddModal = () => {
    setEditingEntry(null);
    setFormCategory('general');
    setFormQuestion('');
    setFormAnswer('');
    setFormKeywords([]);
    setFormTags([]);
    setFormPriority(0);
    setShowModal(true);
  };

  const openEditModal = (entry: KnowledgeEntry) => {
    setEditingEntry(entry);
    setFormCategory(entry.category);
    setFormQuestion(entry.question);
    setFormAnswer(entry.answer);
    setFormKeywords(entry.keywords);
    setFormTags(entry.tags);
    setFormPriority(entry.priority);
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!formAnswer.trim()) return;

    const body = {
      id: editingEntry?.id,
      category: formCategory,
      question: formQuestion,
      answer: formAnswer,
      keywords: formKeywords,
      tags: formTags,
      priority: formPriority,
    };

    try {
      const res = await fetch(`${window.location.origin}/api/knowledge-base`, {
        method: editingEntry ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setShowModal(false);
        fetchEntries();
        fetchCategories();
      }
    } catch { /* ignore */ }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`${window.location.origin}/api/knowledge-base/${id}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setEntries(prev => prev.filter(e => e.id !== id));
        fetchCategories();
      }
    } catch { /* ignore */ }
  };

  const addKeyword = () => {
    const kw = formKeywordInput.trim().toLowerCase();
    if (kw && !formKeywords.includes(kw)) {
      setFormKeywords([...formKeywords, kw]);
    }
    setFormKeywordInput('');
  };

  const addTag = () => {
    const tag = formTagInput.trim().toLowerCase();
    if (tag && !formTags.includes(tag)) {
      setFormTags([...formTags, tag]);
    }
    setFormTagInput('');
  };

  const displayEntries = searchResults
    ? searchResults.map(sr => entries.find(e => e.id === sr.id)).filter(Boolean) as KnowledgeEntry[]
    : entries;

  const filteredEntries = searchQuery && searchResults
    ? displayEntries
    : activeCategory
      ? entries.filter(e => e.category === activeCategory)
      : entries;

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.headerTitle}>
          <Icons.Book />
          <span>Knowledge Base</span>
          {!loading && <span style={{ fontSize: 13, color: 'var(--text-subtle)', fontWeight: 400 }}>({entries.length} entri)</span>}
        </div>
        <div style={styles.headerRight}>
          <div style={styles.searchBar}>
            <Icons.Search />
            <input
              style={styles.searchInput}
              placeholder="Cari di knowledge base..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>
          <button style={styles.addButton} onClick={openAddModal}>
            <Icons.Plus />
            Tambah Entri
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div style={styles.filterBar}>
        <Icons.Filter />
        <button
          style={{...styles.filterChip, ...(!activeCategory ? styles.filterChipActive : {})}}
          onClick={() => setActiveCategory(null)}
        >
          Semua
        </button>
        {categories.map(cat => (
          <button
            key={cat}
            style={{...styles.filterChip, ...(activeCategory === cat ? styles.filterChipActive : {})}}
            onClick={() => setActiveCategory(activeCategory === cat ? null : cat)}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={styles.content}>
        {loading ? (
          <div style={styles.emptyState}>
             <div style={{color: 'var(--text-subtle)'}}>Memuat...</div>
          </div>
        ) : filteredEntries.length === 0 ? (
          <div style={styles.emptyState}>
            <div style={styles.emptyIcon}><Icons.Book /></div>
             <h3 style={{color: 'var(--text-subtle)', marginBottom: 8}}>Belum ada entri knowledge base</h3>
            <p style={{fontSize: 13, marginBottom: 16}}>Tambah informasi produk, FAQ, dan kebijakan agar AI bisa menjawab dengan akurat.</p>
            <button style={styles.addButton} onClick={openAddModal}>
              <Icons.Plus />
              Tambah Entri Pertama
            </button>
          </div>
        ) : (
          filteredEntries.map(entry => {
            const isExpanded = expandedId === entry.id;
            return (
              <div
                key={entry.id}
                style={styles.entryCard}
                onMouseEnter={e => {
                  e.currentTarget.style.borderColor = '#3a3d4e';
                  const actions = e.currentTarget.querySelector('.card-actions') as HTMLElement;
                  if (actions) actions.style.opacity = '1';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.borderColor = 'var(--hover-bg)';
                  const actions = e.currentTarget.querySelector('.card-actions') as HTMLElement;
                  if (actions) actions.style.opacity = '0';
                }}
                onClick={() => setExpandedId(isExpanded ? null : entry.id)}
              >
                <div style={styles.cardHeader}>
                  <div style={styles.cardQuestion}>
                    {entry.question || '(Tanpa pertanyaan)'}
                  </div>
                  <div className="card-actions" style={styles.cardActions}>
                    <button
                      onClick={e => { e.stopPropagation(); openEditModal(entry); }}
                      style={{ background: 'none', border: 'none', color: 'var(--text-subtle)', cursor: 'pointer', padding: 4 }}
                      title="Edit"
                    >
                      <Icons.Edit />
                    </button>
                    <button
                      onClick={e => { e.stopPropagation(); handleDelete(entry.id); }}
                      style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: 4 }}
                      title="Hapus"
                    >
                      <Icons.Trash />
                    </button>
                  </div>
                </div>
                <div style={styles.cardMeta}>
                  <span style={styles.categoryBadge}>{entry.category}</span>
                  {entry.priority > 0 && (
                    <span style={styles.priorityStars}>{'⭐'.repeat(entry.priority)}</span>
                  )}
                  {entry.tags.map(tag => (
                    <span key={tag} style={styles.tagBadge}>{tag}</span>
                  ))}
                  {searchResults && searchResults.find(sr => sr.id === entry.id) && (
                    <span style={styles.resultBadge}>
                      {Math.round((searchResults.find(sr => sr.id === entry.id)?.score || 0) * 100)}% match
                    </span>
                  )}
                </div>
                <div
                  style={{
                    ...styles.cardAnswer,
                    ...(isExpanded ? styles.cardAnswerExpanded : {}),
                  }}
                >
                  {entry.answer}
                  {!isExpanded && <div style={styles.expandFade} />}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <div style={styles.modalOverlay} onClick={() => setShowModal(false)}>
          <div style={styles.modal} onClick={e => e.stopPropagation()}>
            <div style={styles.modalTitle}>
              {editingEntry ? 'Edit Entri Knowledge Base' : 'Tambah Entri Knowledge Base'}
            </div>

            <div style={styles.formGroup}>
              <label style={styles.formLabel}>Kategori</label>
              <input
                style={styles.formInput}
                value={formCategory}
                onChange={e => setFormCategory(e.target.value)}
                placeholder="general, produk, kebijakan, FAQ..."
              />
            </div>

            <div style={styles.formGroup}>
              <label style={styles.formLabel}>Pertanyaan (opsional)</label>
              <input
                style={styles.formInput}
                value={formQuestion}
                onChange={e => setFormQuestion(e.target.value)}
                placeholder="Contoh: Bagaimana cara refund?"
              />
            </div>

            <div style={styles.formGroup}>
              <label style={styles.formLabel}>Jawaban *</label>
              <textarea
                style={styles.formTextarea}
                value={formAnswer}
                onChange={e => setFormAnswer(e.target.value)}
                placeholder="Tulis jawaban lengkap di sini..."
              />
            </div>

            <div style={styles.formGroup}>
              <label style={styles.formLabel}>Kata Kunci</label>
              <div style={styles.keywordInput}>
                <input
                  style={{...styles.formInput, flex: 1}}
                  value={formKeywordInput}
                  onChange={e => setFormKeywordInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addKeyword(); } }}
                  placeholder="contoh: refund, retur, pengembalian"
                />
                <button
                  onClick={addKeyword}
                  style={{ padding: '8px 12px', backgroundColor: 'var(--hover-bg)', border: 'none', borderRadius: 8, color: 'var(--text-subtle)', cursor: 'pointer', fontFamily: 'inherit' }}
                >
                  Tambah
                </button>
              </div>
              <div style={styles.keywordsContainer}>
                {formKeywords.map(kw => (
                  <span key={kw} style={styles.keywordTag}>
                    {kw}
                    <span style={styles.keywordRemove} onClick={() => setFormKeywords(formKeywords.filter(k => k !== kw))}>×</span>
                  </span>
                ))}
              </div>
            </div>

            <div style={styles.formGroup}>
              <label style={styles.formLabel}>Tags</label>
              <div style={styles.keywordInput}>
                <input
                  style={{...styles.formInput, flex: 1}}
                  value={formTagInput}
                  onChange={e => setFormTagInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
                  placeholder="contoh: penting, promo, urgent"
                />
                <button
                  onClick={addTag}
                  style={{ padding: '8px 12px', backgroundColor: 'var(--hover-bg)', border: 'none', borderRadius: 8, color: 'var(--text-subtle)', cursor: 'pointer', fontFamily: 'inherit' }}
                >
                  Tambah
                </button>
              </div>
              <div style={styles.keywordsContainer}>
                {formTags.map(tag => (
                  <span key={tag} style={{...styles.keywordTag, backgroundColor: 'rgba(34, 197, 94, 0.15)', color: '#4ade80'}}>
                    {tag}
                    <span style={styles.keywordRemove} onClick={() => setFormTags(formTags.filter(t => t !== tag))}>×</span>
                  </span>
                ))}
              </div>
            </div>

            <div style={styles.formGroup}>
              <label style={styles.formLabel}>Prioritas (0-5)</label>
              <div style={{ display: 'flex', gap: 4 }}>
                {[0, 1, 2, 3, 4, 5].map(p => (
                  <button
                    key={p}
                    onClick={() => setFormPriority(p)}
                    style={{
                      padding: '6px 12px',
                      backgroundColor: formPriority === p ? 'rgba(139, 92, 246, 0.2)' : 'var(--input-bg)',
                      border: formPriority === p ? '1px solid #8b5cf6' : '1px solid var(--hover-bg)',
                      borderRadius: 6,
                      color: formPriority === p ? '#8b5cf6' : 'var(--text-subtle)',
                      cursor: 'pointer',
                      fontSize: 12,
                      fontFamily: 'inherit',
                    }}
                  >
                    {p === 0 ? '-' : '⭐'.repeat(p)}
                  </button>
                ))}
              </div>
            </div>

            <div style={styles.modalActions}>
              <button style={styles.cancelButton} onClick={() => setShowModal(false)}>Batal</button>
              <button style={styles.saveButton} onClick={handleSave}>
                {editingEntry ? 'Simpan Perubahan' : 'Tambah Entri'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
