import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Eye, EyeOff, CheckCircle2, XCircle, ExternalLink, Key } from 'lucide-react';
import { apiKeyManager } from '../utils/apiKeyManager';

interface ApiKeySettingsProps {
  open: boolean;
  onClose: () => void;
}

export function ApiKeySettings({ open, onClose }: ApiKeySettingsProps) {
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [visible, setVisible] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState(false);
  const keyInfos = apiKeyManager.getStatus();

  useEffect(() => {
    if (open) setKeys(apiKeyManager.getAllKeys());
  }, [open]);

  const handleSave = () => {
    Object.entries(keys).forEach(([k, v]) => {
      if (v) apiKeyManager.setKey(k, v);
      else apiKeyManager.removeKey(k);
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const toggleVisible = (key: string) =>
    setVisible(v => ({ ...v, [key]: !v[key] }));

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/60 z-40"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 16 }}
            transition={{ type: 'spring', damping: 28, stiffness: 350 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
          >
            <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-lg max-h-[80vh] flex flex-col shadow-2xl">
              <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
                <div className="flex items-center gap-2">
                  <Key className="h-4 w-4 text-blue-400" />
                  <span className="font-semibold text-zinc-100">API Key Settings</span>
                </div>
                <button data-testid="button-close-settings" onClick={onClose} className="text-zinc-500 hover:text-zinc-200 transition-colors">
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="flex-1 overflow-auto px-5 py-4 space-y-3">
                <p className="text-xs text-zinc-500 mb-4">
                  API keys are stored locally in your browser. They are never sent to any server other than the respective API providers.
                </p>

                {keyInfos.map(info => (
                  <div key={info.key} className="border border-zinc-800 rounded-lg p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {info.configured ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                        ) : (
                          <XCircle className="h-3.5 w-3.5 text-zinc-600 shrink-0" />
                        )}
                        <span className="text-sm text-zinc-200">{info.name}</span>
                      </div>
                      <a
                        href={info.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors"
                      >
                        Get key <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        data-testid={`input-apikey-${info.key}`}
                        type={visible[info.key] ? 'text' : 'password'}
                        value={keys[info.key] || ''}
                        onChange={e => setKeys(k => ({ ...k, [info.key]: e.target.value }))}
                        placeholder={info.configured ? info.maskedValue : 'Paste key here...'}
                        className="flex-1 bg-zinc-950 border border-zinc-700 rounded-md px-3 py-1.5 text-xs font-mono text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-blue-500 transition-colors"
                      />
                      <button
                        data-testid={`button-toggle-visibility-${info.key}`}
                        onClick={() => toggleVisible(info.key)}
                        className="text-zinc-600 hover:text-zinc-300 transition-colors"
                      >
                        {visible[info.key] ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                    <div className="text-[10px] text-zinc-600 font-mono">{info.envVar}</div>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-zinc-800">
                <button
                  data-testid="button-cancel-settings"
                  onClick={onClose}
                  className="text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
                >
                  Cancel
                </button>
                <button
                  data-testid="button-save-settings"
                  onClick={handleSave}
                  className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                    saved ? 'bg-emerald-600 text-white' : 'bg-blue-600 hover:bg-blue-500 text-white'
                  }`}
                >
                  {saved ? <CheckCircle2 className="h-4 w-4" /> : null}
                  {saved ? 'Saved!' : 'Save Keys'}
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
