import { motion, AnimatePresence } from 'framer-motion';
import { X, Copy, ExternalLink, Download, MapPin } from 'lucide-react';
import type { InvestigationNode } from '../types';

interface NodeDetailPanelProps {
  node: InvestigationNode | null;
  onClose: () => void;
}

function DataRow({ k, v }: { k: string; v: unknown }) {
  const valueStr = typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v ?? '');
  return (
    <div className="py-1.5 border-b border-zinc-800 last:border-0">
      <div className="text-xs text-zinc-500 mb-0.5">{k}</div>
      <div className="text-xs text-zinc-200 font-mono break-all whitespace-pre-wrap max-h-32 overflow-auto">{valueStr}</div>
    </div>
  );
}

export function NodeDetailPanel({ node, onClose }: NodeDetailPanelProps) {
  const copyValue = () => {
    if (node) navigator.clipboard.writeText(node.identifierValue);
  };

  const downloadData = () => {
    if (!node) return;
    const blob = new Blob([JSON.stringify(node.data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${node.identifierType}_${node.identifierValue.slice(0, 20)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const shareData = () => {
    if (!node) return;
    if (navigator.share) {
      navigator.share({ title: node.identifierTypeName, text: node.identifierValue }).catch(() => {});
    } else {
      navigator.clipboard.writeText(node.identifierValue);
    }
  };

  return (
    <AnimatePresence>
      {node && (
        <motion.div
          initial={{ x: 320, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 320, opacity: 0 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className="absolute right-0 top-0 h-full w-72 bg-zinc-900 border-l border-zinc-800 flex flex-col z-20 overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-xl leading-none">{node.identifierTypeIcon}</span>
              <div className="min-w-0">
                <div className="text-sm font-medium text-zinc-100 truncate">{node.identifierTypeName}</div>
                <div className="text-xs text-zinc-500 truncate">{node.identifierTypeNameAr}</div>
              </div>
            </div>
            <button
              data-testid="button-close-detail"
              onClick={onClose}
              className="text-zinc-500 hover:text-zinc-200 transition-colors shrink-0"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Value */}
          <div className="px-4 py-3 border-b border-zinc-800 shrink-0 bg-zinc-950">
            <div className="text-xs text-zinc-500 mb-1">Value</div>
            <div className="text-sm font-mono text-blue-300 break-all">{node.identifierValue}</div>
          </div>

          {/* Status & meta */}
          <div className="px-4 py-2 border-b border-zinc-800 shrink-0 flex items-center gap-3">
            <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
              node.status === 'fetched' ? 'bg-emerald-900 text-emerald-300' :
              node.status === 'error' ? 'bg-red-900 text-red-300' :
              node.status === 'pending' ? 'bg-amber-900 text-amber-300' : 'bg-zinc-800 text-zinc-400'
            }`}>
              {node.status}
            </span>
            <span className="text-xs text-zinc-600">Depth {node.depth}</span>
            <span className="text-xs text-zinc-600">{new Date(node.data.timestamp).toLocaleTimeString()}</span>
          </div>

          {/* Actions */}
          <div className="px-4 py-2 border-b border-zinc-800 shrink-0 flex items-center gap-2">
            <button data-testid="button-copy-node" onClick={copyValue} className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors">
              <Copy className="h-3.5 w-3.5" /> Copy
            </button>
            <button data-testid="button-download-node" onClick={downloadData} className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors">
              <Download className="h-3.5 w-3.5" /> Download
            </button>
            <button data-testid="button-share-node" onClick={shareData} className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors">
              <ExternalLink className="h-3.5 w-3.5" /> Share
            </button>
          </div>

          {/* Map preview for coordinates */}
          {node.identifierType === 'coordinates' && node.data.metadata.latitude && (
            <div className="px-4 py-2 border-b border-zinc-800 shrink-0">
              <a
                href={String(node.data.metadata.googleMapsUrl ?? '')}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-xs text-blue-400 hover:text-blue-300"
              >
                <MapPin className="h-3.5 w-3.5" />
                Open in Google Maps
              </a>
            </div>
          )}

          {/* Data */}
          <div className="flex-1 overflow-auto px-4 py-2">
            {node.data.rawResult?.data && Object.keys(node.data.rawResult.data).length > 0 ? (
              Object.entries(node.data.rawResult.data).map(([k, v]) => (
                <DataRow key={k} k={k} v={v} />
              ))
            ) : (
              <div className="text-xs text-zinc-600 mt-4 text-center">No data fetched yet</div>
            )}
          </div>

          {/* Source */}
          {node.data.rawResult?.source && (
            <div className="px-4 py-2 border-t border-zinc-800 shrink-0 text-xs text-zinc-600">
              Source: {node.data.rawResult.source}
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
