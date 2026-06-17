import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Search, X } from 'lucide-react';
import { searchIdentifiers, IDENTIFIER_LIST } from '../utils/identifierList';
import type { IdentifierDefinition } from '../types';

interface IdentifierSelectorProps {
  onSelect: (def: IdentifierDefinition) => void;
  selected?: string;
}

export function IdentifierSelector({ onSelect, selected }: IdentifierSelectorProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const results = query.length > 0 ? searchIdentifiers(query) : IDENTIFIER_LIST.slice(0, 40);
  const selectedDef = selected ? IDENTIFIER_LIST.find(d => d.id === selected) : undefined;

  const handleSelect = useCallback((def: IdentifierDefinition) => {
    onSelect(def);
    setOpen(false);
    setQuery('');
  }, [onSelect]);

  return (
    <div className="relative">
      <button
        data-testid="button-identifier-selector"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-xs text-zinc-300 transition-colors max-w-[160px]"
      >
        {selectedDef ? (
          <>
            <span>{selectedDef.icon}</span>
            <span className="truncate">{selectedDef.name}</span>
          </>
        ) : (
          <span className="truncate">All Types ({IDENTIFIER_LIST.length})</span>
        )}
        <ChevronDown className={`h-3 w-3 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => { setOpen(false); setQuery(''); }} />
            <motion.div
              initial={{ opacity: 0, y: -4, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.97 }}
              transition={{ duration: 0.12 }}
              className="absolute top-full mt-1 left-0 z-50 bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl overflow-hidden w-72"
            >
              <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800">
                <Search className="h-3.5 w-3.5 text-zinc-500 shrink-0" />
                <input
                  data-testid="input-identifier-search"
                  autoFocus
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Search identifiers..."
                  className="flex-1 bg-transparent text-xs text-zinc-200 placeholder:text-zinc-600 outline-none"
                />
                {query && <button onClick={() => setQuery('')}><X className="h-3 w-3 text-zinc-500" /></button>}
              </div>

              <div className="max-h-64 overflow-auto">
                {selectedDef && (
                  <button
                    data-testid="button-clear-type-filter"
                    onClick={() => { onSelect(undefined as unknown as IdentifierDefinition); setOpen(false); }}
                    className="w-full text-left px-3 py-2 text-xs text-zinc-400 hover:bg-zinc-800 transition-colors border-b border-zinc-800"
                  >
                    Clear filter (show all)
                  </button>
                )}
                {results.map(def => (
                  <button
                    key={def.id}
                    data-testid={`button-select-identifier-${def.id}`}
                    onClick={() => handleSelect(def)}
                    className={`flex items-center gap-2.5 w-full px-3 py-2 text-left hover:bg-zinc-800 transition-colors ${selected === def.id ? 'bg-blue-900/30' : ''}`}
                  >
                    <span className="text-base leading-none">{def.icon}</span>
                    <div className="min-w-0">
                      <div className="text-xs text-zinc-200 truncate">{def.name}</div>
                      <div className="text-[10px] text-zinc-500 truncate">{def.nameAr}</div>
                    </div>
                    <span className="ml-auto shrink-0 text-[10px] text-zinc-600 capitalize">{def.category}</span>
                  </button>
                ))}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
