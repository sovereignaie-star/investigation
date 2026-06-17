import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Key, FolderOpen, Settings2, RotateCcw, Microscope } from 'lucide-react';

import { SearchBar } from '../components/SearchBar';
import { InfiniteCanvas } from '../components/InfiniteCanvas';
import { InvestigationStats } from '../components/InvestigationStats';
import { NodeDetailPanel } from '../components/NodeDetailPanel';
import { ApiKeySettings } from '../components/ApiKeySettings';
import { SavedInvestigations } from '../components/SavedInvestigations';
import { ExportMenu } from '../components/ExportMenu';
import { ProgressBar } from '../components/ProgressBar';
import { IdentifierSelector } from '../components/IdentifierSelector';
import { apiKeyManager } from '../utils/apiKeyManager';
import { investigate, type InvestigationProgress } from '../utils/smartInvestigator';
import { useInvestigationStore } from '../store/investigationStore';
import type { InvestigationNode, InvestigationLink, IdentifierDefinition } from '../types';

export function InvestigationRoom() {
  const {
    nodes, links, rootId, selectedNodeId, status, startTime,
    getStats, setSearchValue, startInvestigation, stopInvestigation,
    resetInvestigation, setStatus, addNode, updateNode, addLink, setRootId,
    selectNode, setElapsed, loadGraph, stopSignal,
  } = useInvestigationStore();

  const [progress, setProgress] = useState<InvestigationProgress | null>(null);
  const [showApiKeys, setShowApiKeys] = useState(false);
  const [showSaved, setShowSaved] = useState(false);
  const [forcedType, setForcedType] = useState<IdentifierDefinition | undefined>();
  const elapsedTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Elapsed timer
  useEffect(() => {
    if (status === 'running') {
      elapsedTimer.current = setInterval(() => {
        if (startTime) setElapsed(Math.floor((Date.now() - startTime) / 1000));
      }, 1000);
    } else {
      if (elapsedTimer.current) clearInterval(elapsedTimer.current);
    }
    return () => { if (elapsedTimer.current) clearInterval(elapsedTimer.current); };
  }, [status, startTime, setElapsed]);

  const handleSearch = useCallback(async (value: string) => {
    setSearchValue(value);
    startInvestigation();

    const apiKeys = apiKeyManager.getAllKeys();
    const signal = useInvestigationStore.getState().stopSignal;
    let localRootId = '';

    try {
      const result = await investigate(value, {
        maxDepth: 2,
        maxNodes: 60,
        apiKeys,
        confidenceThreshold: 0.5,
        stopSignal: signal,
        onProgress: p => {
          setProgress(p);
          if (p.status === 'completed' || p.status === 'stopped') {
            setStatus(p.status === 'completed' ? 'completed' : 'paused');
          }
        },
        onNodeAdded: node => {
          addNode(node);
          if (!localRootId) {
            localRootId = node.id;
            setRootId(node.id);
          }
        },
        onNodeUpdated: node => {
          updateNode(node);
        },
      });

      // Ensure all links are added
      for (const link of result.links) {
        addLink(link);
      }

      setStatus('completed');
    } catch (err) {
      console.error('Investigation error:', err);
      setStatus('error');
    }

    setProgress(null);
  }, [setSearchValue, startInvestigation, setStatus, addNode, updateNode, addLink, setRootId]);

  const handleStop = useCallback(() => {
    stopInvestigation();
    setProgress(null);
  }, [stopInvestigation]);

  const handleReset = useCallback(() => {
    resetInvestigation();
    setProgress(null);
  }, [resetInvestigation]);

  const handleLoadGraph = useCallback((loadedNodes: InvestigationNode[], loadedLinks: InvestigationLink[], loadedRootId: string) => {
    loadGraph(loadedNodes, loadedLinks, loadedRootId);
  }, [loadGraph]);

  const selectedNode = selectedNodeId ? nodes.find(n => n.id === selectedNodeId) ?? null : null;
  const stats = getStats();
  const isRunning = status === 'running';

  return (
    <div className="flex flex-col h-screen bg-zinc-950 overflow-hidden select-none">
      <ProgressBar visible={isRunning} label={progress ? `Investigating: ${progress.currentValue.slice(0, 60)} (${progress.nodesFetched} nodes found)` : undefined} />

      {/* Header */}
      <header className="flex items-center gap-4 px-4 py-3 border-b border-zinc-800 bg-zinc-950 shrink-0 z-10">
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-blue-600">
            <Microscope className="h-4 w-4 text-white" />
          </div>
          <div className="hidden sm:block">
            <div className="text-sm font-bold text-zinc-100 leading-tight">Investigation Room</div>
            <div className="text-[10px] text-zinc-500 leading-tight">غرفة التحقيق</div>
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <SearchBar
            onSearch={handleSearch}
            isRunning={isRunning}
            onStop={handleStop}
          />
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <IdentifierSelector
            selected={forcedType?.id}
            onSelect={def => setForcedType(def)}
          />
          <button
            data-testid="button-open-saved"
            onClick={() => setShowSaved(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-xs text-zinc-300 transition-colors"
            title="Saved Investigations"
          >
            <FolderOpen className="h-3.5 w-3.5" />
            <span className="hidden md:inline">Saved</span>
          </button>
          <button
            data-testid="button-open-api-keys"
            onClick={() => setShowApiKeys(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-xs text-zinc-300 transition-colors"
            title="API Key Settings"
          >
            <Key className="h-3.5 w-3.5" />
            <span className="hidden md:inline">API Keys</span>
          </button>
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left sidebar — Stats */}
        <aside className="hidden lg:flex flex-col w-52 border-r border-zinc-800 bg-zinc-950 shrink-0 overflow-auto">
          <InvestigationStats stats={stats} />
        </aside>

        {/* Canvas */}
        <div className="flex-1 relative overflow-hidden">
          <InfiniteCanvas
            nodes={nodes}
            links={links}
            onNodeClick={id => selectNode(id === selectedNodeId ? null : id)}
            selectedNodeId={selectedNodeId}
          />

          {/* Node detail panel (overlaid on right of canvas) */}
          <NodeDetailPanel
            node={selectedNode}
            onClose={() => selectNode(null)}
          />
        </div>
      </div>

      {/* Bottom toolbar */}
      <footer className="flex items-center justify-between px-4 py-2.5 border-t border-zinc-800 bg-zinc-950 shrink-0 z-10">
        <div className="flex items-center gap-2 text-xs text-zinc-600">
          <span>{nodes.length} nodes</span>
          <span>·</span>
          <span>{links.length} links</span>
          {status === 'running' && (
            <>
              <span>·</span>
              <span className="text-blue-400 animate-pulse">running</span>
            </>
          )}
          {status === 'completed' && (
            <>
              <span>·</span>
              <span className="text-emerald-400">complete</span>
            </>
          )}
        </div>

        <div className="flex items-center gap-2">
          {nodes.length > 0 && (
            <button
              data-testid="button-reset-all"
              onClick={handleReset}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Clear
            </button>
          )}
          <ExportMenu nodes={nodes} links={links} rootId={rootId} onReset={handleReset} />
        </div>
      </footer>

      {/* Modals */}
      <ApiKeySettings open={showApiKeys} onClose={() => setShowApiKeys(false)} />
      <SavedInvestigations open={showSaved} onClose={() => setShowSaved(false)} onLoad={handleLoadGraph} />
    </div>
  );
}
