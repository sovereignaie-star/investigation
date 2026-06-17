import { useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Paperclip, Loader2, X, ChevronDown } from 'lucide-react';
import { detectIdentifier } from '../utils/identifierList';
import type { DetectionResult } from '../types';

interface SearchBarProps {
  onSearch: (value: string) => void;
  isRunning: boolean;
  onStop: () => void;
}

export function SearchBar({ onSearch, isRunning, onStop }: SearchBarProps) {
  const [value, setValue] = useState('');
  const [detection, setDetection] = useState<DetectionResult | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleChange = useCallback((v: string) => {
    setValue(v);
    if (v.trim().length > 2) {
      setDetection(detectIdentifier(v.trim()));
    } else {
      setDetection(null);
    }
  }, []);

  const handleSubmit = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || isRunning) return;
    onSearch(trimmed);
  }, [value, isRunning, onSearch]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSubmit();
  }, [handleSubmit]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData('text');
    if (text) {
      handleChange(text.trim());
      return;
    }
    const items = Array.from(e.clipboardData.items);
    const imageItem = items.find(i => i.type.startsWith('image/'));
    if (imageItem) {
      e.preventDefault();
      const file = imageItem.getAsFile();
      if (file) handleFile(file);
    }
  }, [handleChange]);

  const handleFile = useCallback((file: File) => {
    const name = file.name;
    const size = (file.size / 1024).toFixed(1) + ' KB';
    setValue(`[File: ${name} (${size})]`);
    setDetection({ identifierId: 'file', identifierName: 'File', identifierNameAr: 'ملف', icon: '📁', value: name, confidence: 'medium', multipleMatches: false, alternativeMatches: [], suggestedNodeType: 'file' });

    // Try to read text content for analysis
    if (file.type.startsWith('text/') || file.name.endsWith('.txt') || file.name.endsWith('.json')) {
      const reader = new FileReader();
      reader.onload = e => {
        const text = e.target?.result as string;
        if (text) {
          setValue(text.substring(0, 500));
          handleChange(text.trim());
        }
      };
      reader.readAsText(file);
    }
  }, [handleChange]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files[0]) handleFile(files[0]);
    const text = e.dataTransfer.getData('text');
    if (text && !files[0]) handleChange(text);
  }, [handleFile, handleChange]);

  const confidenceColor = detection
    ? detection.confidence === 'high' ? 'text-emerald-400' : detection.confidence === 'medium' ? 'text-amber-400' : 'text-zinc-400'
    : '';

  return (
    <div className="flex flex-col gap-2">
      <div
        onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={`relative flex items-center gap-2 rounded-lg border bg-zinc-900 px-3 py-2.5 transition-all ${isDragging ? 'border-blue-500 shadow-[0_0_0_2px_hsla(217,91%,60%,0.3)]' : 'border-zinc-700'}`}
      >
        <Search className="h-4 w-4 shrink-0 text-zinc-500" />

        <input
          data-testid="input-search"
          type="text"
          value={value}
          onChange={e => handleChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder="Enter any identifier — email, IP, hash, IMEI, URL, wallet address..."
          className="flex-1 bg-transparent text-sm text-zinc-100 placeholder:text-zinc-600 outline-none min-w-0"
          dir="auto"
        />

        {value && (
          <button
            data-testid="button-clear-search"
            onClick={() => { setValue(''); setDetection(null); }}
            className="text-zinc-600 hover:text-zinc-300 transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}

        <button
          data-testid="button-attach-file"
          onClick={() => fileInputRef.current?.click()}
          className="text-zinc-500 hover:text-zinc-300 transition-colors"
          title="Attach file"
        >
          <Paperclip className="h-4 w-4" />
        </button>
        <input ref={fileInputRef} type="file" className="hidden" onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />

        {isRunning ? (
          <button
            data-testid="button-stop-investigation"
            onClick={onStop}
            className="flex items-center gap-1.5 rounded-md bg-red-600 hover:bg-red-500 px-3 py-1.5 text-xs font-medium text-white transition-colors shrink-0"
          >
            <div className="h-2 w-2 rounded-sm bg-white" />
            Stop
          </button>
        ) : (
          <button
            data-testid="button-start-investigation"
            onClick={handleSubmit}
            disabled={!value.trim()}
            className="flex items-center gap-1.5 rounded-md bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed px-3 py-1.5 text-xs font-medium text-white transition-colors shrink-0"
          >
            <Search className="h-3.5 w-3.5" />
            Investigate
          </button>
        )}
      </div>

      <AnimatePresence>
        {detection && detection.identifierId !== 'unknown' && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="flex items-center gap-2 text-xs"
          >
            <span className="text-zinc-500">Detected:</span>
            <span className="text-lg leading-none">{detection.icon}</span>
            <span className="font-medium text-zinc-200">{detection.identifierName}</span>
            <span className={`text-xs ${confidenceColor}`}>
              ({detection.confidence} confidence)
            </span>
            {detection.multipleMatches && (
              <span className="text-zinc-600">· {detection.alternativeMatches.length} other matches</span>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
