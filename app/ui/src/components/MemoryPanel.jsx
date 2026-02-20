import React, { useState, useEffect } from 'react';
import { getMemories, deleteMemory, clearMemories } from '../services/api';

const CATEGORY_STYLES = {
  personal_fact: { label: 'Personal',   className: 'bg-blue-500/15 text-blue-400' },
  preference:    { label: 'Preference', className: 'bg-purple-500/15 text-purple-400' },
  goal:          { label: 'Goal',       className: 'bg-amber-500/15 text-amber-400' },
  project:       { label: 'Project',    className: 'bg-teal-500/15 text-teal-400' },
  episodic:      { label: 'Episodic',   className: 'bg-dark-600 text-dark-400' },
};

function ConfidenceDot({ confidence }) {
  const c = confidence ?? 1.0;
  const color = c >= 0.8 ? 'bg-green-500' : c >= 0.5 ? 'bg-amber-500' : 'bg-red-400';
  const label = c >= 0.8 ? 'High' : c >= 0.5 ? 'Medium' : 'Low';
  return (
    <span className="flex items-center gap-1.5 text-xs text-dark-500">
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${color}`} />
      {label} confidence
    </span>
  );
}

function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function MemoryPanel({ onClose }) {
  const [memories, setMemories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [clearing, setClearing] = useState(false);

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setMemories(await getMemories());
    } catch {
      setError('Failed to load memories');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id) => {
    setDeletingId(id);
    try {
      await deleteMemory(id);
      setMemories(prev => prev.filter(m => m.ID !== id));
    } catch (e) {
      console.error('Failed to delete memory:', e);
    } finally {
      setDeletingId(null);
    }
  };

  const handleClearAll = async () => {
    if (!confirming) { setConfirming(true); return; }
    setClearing(true);
    try {
      await clearMemories();
      setMemories([]);
    } catch (e) {
      console.error('Failed to clear memories:', e);
    } finally {
      setClearing(false);
      setConfirming(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 z-[100] flex items-center justify-center p-4">
      <div className="bg-dark-900 rounded-xl border border-dark-700 w-full max-w-xl max-h-[80vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-dark-700 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <h2 className="text-base font-semibold text-dark-100">Memories</h2>
            {!loading && (
              <span className="text-xs text-dark-500 bg-dark-800 px-2 py-0.5 rounded-full">
                {memories.length}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {memories.length > 0 && !loading && (
              <>
                {confirming && (
                  <button
                    onClick={() => setConfirming(false)}
                    className="text-xs px-3 py-1.5 rounded-lg text-dark-400 hover:bg-dark-800 transition-colors"
                  >
                    Cancel
                  </button>
                )}
                <button
                  onClick={handleClearAll}
                  disabled={clearing}
                  className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${
                    confirming
                      ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                      : 'text-dark-400 hover:text-red-400 hover:bg-dark-800'
                  }`}
                >
                  {clearing ? 'Clearing…' : confirming ? 'Confirm clear all' : 'Clear all'}
                </button>
              </>
            )}
            <button
              onClick={onClose}
              className="p-1 rounded hover:bg-dark-800 text-dark-400 hover:text-white transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-dark-500 text-sm">
              <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Loading…
            </div>
          ) : error ? (
            <div className="text-center py-16 text-red-400 text-sm">{error}</div>
          ) : memories.length === 0 ? (
            <div className="text-center py-16">
              <svg className="w-10 h-10 mx-auto mb-3 text-dark-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
              <p className="text-dark-400 text-sm">No memories yet</p>
              <p className="text-dark-600 text-xs mt-1">Facts are extracted from your conversations automatically</p>
            </div>
          ) : (
            <div className="space-y-2">
              {memories.map(memory => {
                const cat = CATEGORY_STYLES[memory.category]
                  ?? { label: memory.category ?? 'Unknown', className: 'bg-dark-700 text-dark-400' };
                return (
                  <div
                    key={memory.ID}
                    className="group relative flex gap-3 p-3 rounded-lg bg-dark-800 border border-dark-700 hover:border-dark-600 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-dark-100 leading-relaxed">{memory.content}</p>
                      <div className="flex items-center gap-3 mt-2 flex-wrap">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cat.className}`}>
                          {cat.label}
                        </span>
                        <ConfidenceDot confidence={memory.confidence} />
                        {memory.accessCount > 0 && (
                          <span className="text-xs text-dark-500">
                            {memory.accessCount}× recalled
                          </span>
                        )}
                        <span className="text-xs text-dark-600">{formatDate(memory.createdAt)}</span>
                      </div>
                    </div>

                    <button
                      onClick={() => handleDelete(memory.ID)}
                      disabled={deletingId === memory.ID}
                      title="Delete memory"
                      className="opacity-0 group-hover:opacity-100 p-1.5 rounded hover:bg-dark-700 text-dark-500 hover:text-red-400 transition-all flex-shrink-0 self-start mt-0.5"
                    >
                      {deletingId === memory.ID ? (
                        <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
