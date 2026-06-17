import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Download, FileJson, Image, Save, Trash2, RotateCcw, ChevronDown } from 'lucide-react';
import { investigationDB } from '../utils/investigationDatabase';
import type { InvestigationNode, InvestigationLink } from '../types';

interface ExportMenuProps {
  nodes: InvestigationNode[];
  links: InvestigationLink[];
  rootId: string | null;
  onReset: () => void;
}

export function ExportMenu({ nodes, links, rootId, onReset }: ExportMenuProps) {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);

  const exportJSON = () => {
    const data = { nodes, links, rootId, exportedAt: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `investigation_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setOpen(false);
  };

  const saveToDb = async () => {
    const graphJson = JSON.stringify({ nodes, links, rootId });
    const rootNode = nodes.find(n => n.id === rootId);
    await investigationDB.saveInvestigation(
      graphJson,
      undefined,
      rootNode?.identifierValue || '',
      nodes.length
    ).catch(() => {});
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    setOpen(false);
  };

  const handleReset = () => {
    if (confirm('Clear the current investigation? This cannot be undone.')) {
      onReset();
      setOpen(false);
    }
  };

  return (
    <div className="relative">
      <button
        data-testid="button-export-menu"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-xs text-zinc-300 transition-colors"
      >
        <Download className="h-3.5 w-3.5" />
        Export
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: -4, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.97 }}
              transition={{ duration: 0.12 }}
              className="absolute bottom-full mb-1 right-0 z-50 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl overflow-hidden min-w-[180px]"
            >
              <button
                data-testid="button-export-json"
                onClick={exportJSON}
                disabled={nodes.length === 0}
                className="flex items-center gap-2.5 w-full px-4 py-2.5 text-xs text-zinc-200 hover:bg-zinc-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <FileJson className="h-4 w-4 text-blue-400" />
                Export as JSON
              </button>

              <button
                data-testid="button-save-investigation"
                onClick={saveToDb}
                disabled={nodes.length === 0}
                className="flex items-center gap-2.5 w-full px-4 py-2.5 text-xs text-zinc-200 hover:bg-zinc-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Save className={`h-4 w-4 ${saved ? 'text-emerald-400' : 'text-zinc-400'}`} />
                {saved ? 'Saved!' : 'Save Investigation'}
              </button>

              <div className="border-t border-zinc-800" />

              <button
                data-testid="button-reset-investigation"
                onClick={handleReset}
                className="flex items-center gap-2.5 w-full px-4 py-2.5 text-xs text-red-400 hover:bg-zinc-800 transition-colors"
              >
                <Trash2 className="h-4 w-4" />
                Clear Canvas
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
