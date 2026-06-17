import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, FolderOpen, Trash2, Download, Edit2, Check } from 'lucide-react';
import { investigationDB } from '../utils/investigationDatabase';
import type { SavedInvestigation, InvestigationNode, InvestigationLink } from '../types';

interface SavedInvestigationsProps {
  open: boolean;
  onClose: () => void;
  onLoad: (nodes: InvestigationNode[], links: InvestigationLink[], rootId: string) => void;
}

export function SavedInvestigations({ open, onClose, onLoad }: SavedInvestigationsProps) {
  const [investigations, setInvestigations] = useState<SavedInvestigation[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    const list = await investigationDB.listInvestigations().catch(() => []);
    setInvestigations(list);
  }, []);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  const handleDelete = async (id: string) => {
    await investigationDB.deleteInvestigation(id).catch(() => {});
    refresh();
  };

  const handleLoad = async (inv: SavedInvestigation) => {
    setLoading(true);
    try {
      const parsed = JSON.parse(inv.graphJson);
      const nodes: InvestigationNode[] = parsed.nodes || [];
      const links: InvestigationLink[] = parsed.links || [];
      const rootId: string = parsed.rootId || nodes[0]?.id || '';
      onLoad(nodes, links, rootId);
      onClose();
    } catch {
      alert('Could not load investigation — data may be corrupted.');
    } finally {
      setLoading(false);
    }
  };

  const handleExport = (inv: SavedInvestigation) => {
    const blob = new Blob([inv.graphJson], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `investigation_${inv.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleRename = async (id: string) => {
    await investigationDB.updateInvestigation(id, { name: editName }).catch(() => {});
    setEditingId(null);
    refresh();
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose} className="fixed inset-0 bg-black/60 z-40"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 16 }}
            transition={{ type: 'spring', damping: 28, stiffness: 350 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
          >
            <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-lg max-h-[70vh] flex flex-col shadow-2xl">
              <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
                <div className="flex items-center gap-2">
                  <FolderOpen className="h-4 w-4 text-blue-400" />
                  <span className="font-semibold text-zinc-100">Saved Investigations</span>
                </div>
                <button data-testid="button-close-saved" onClick={onClose} className="text-zinc-500 hover:text-zinc-200 transition-colors">
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="flex-1 overflow-auto p-4 space-y-2">
                {investigations.length === 0 ? (
                  <div className="text-center py-12 text-zinc-600 text-sm">
                    No saved investigations yet.
                    <br />
                    Complete an investigation and save it to see it here.
                  </div>
                ) : investigations.map(inv => (
                  <motion.div
                    key={inv.id}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="border border-zinc-800 rounded-lg p-3 hover:border-zinc-700 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        {editingId === inv.id ? (
                          <div className="flex items-center gap-2">
                            <input
                              data-testid={`input-rename-${inv.id}`}
                              value={editName}
                              onChange={e => setEditName(e.target.value)}
                              className="flex-1 bg-zinc-950 border border-zinc-600 rounded px-2 py-1 text-sm text-zinc-100 outline-none focus:border-blue-500"
                              onKeyDown={e => e.key === 'Enter' && handleRename(inv.id)}
                              autoFocus
                            />
                            <button data-testid={`button-confirm-rename-${inv.id}`} onClick={() => handleRename(inv.id)} className="text-emerald-400 hover:text-emerald-300">
                              <Check className="h-4 w-4" />
                            </button>
                          </div>
                        ) : (
                          <div className="font-medium text-zinc-200 text-sm truncate">{inv.name}</div>
                        )}
                        <div className="flex items-center gap-3 mt-1 text-xs text-zinc-600">
                          <span>{inv.nodeCount} nodes</span>
                          <span>{new Date(inv.createdAt).toLocaleDateString()}</span>
                          <span className="truncate">{inv.rootValue.slice(0, 30)}</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          data-testid={`button-rename-inv-${inv.id}`}
                          onClick={() => { setEditingId(inv.id); setEditName(inv.name); }}
                          className="p-1.5 text-zinc-600 hover:text-zinc-300 transition-colors"
                          title="Rename"
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          data-testid={`button-export-inv-${inv.id}`}
                          onClick={() => handleExport(inv)}
                          className="p-1.5 text-zinc-600 hover:text-zinc-300 transition-colors"
                          title="Export"
                        >
                          <Download className="h-3.5 w-3.5" />
                        </button>
                        <button
                          data-testid={`button-delete-inv-${inv.id}`}
                          onClick={() => handleDelete(inv.id)}
                          className="p-1.5 text-zinc-600 hover:text-red-400 transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          data-testid={`button-load-inv-${inv.id}`}
                          onClick={() => handleLoad(inv)}
                          disabled={loading}
                          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded-md font-medium transition-colors disabled:opacity-50"
                        >
                          Load
                        </button>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
