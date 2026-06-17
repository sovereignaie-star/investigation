import { motion } from 'framer-motion';
import { Activity, Link2, Layers, Clock, AlertCircle } from 'lucide-react';
import type { InvestigationStats as Stats } from '../types';

interface InvestigationStatsProps {
  stats: Stats;
}

function StatRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-zinc-800 last:border-0">
      <div className="flex items-center gap-2 text-zinc-400 text-xs">
        {icon}
        <span>{label}</span>
      </div>
      <span className="text-xs font-mono font-medium text-zinc-200">{value}</span>
    </div>
  );
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const STATUS_STYLES: Record<string, string> = {
  idle: 'bg-zinc-700 text-zinc-300',
  running: 'bg-blue-600 text-white',
  paused: 'bg-amber-600 text-white',
  completed: 'bg-emerald-600 text-white',
  error: 'bg-red-600 text-white',
};

export function InvestigationStats({ stats }: InvestigationStatsProps) {
  const topCategories = Object.entries(stats.byCategory)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  return (
    <div className="flex flex-col gap-3 p-3 text-sm">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Investigation</span>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_STYLES[stats.status] ?? STATUS_STYLES.idle}`}>
          {stats.status}
        </span>
      </div>

      <div>
        <StatRow icon={<Activity className="h-3 w-3" />} label="Nodes" value={stats.nodeCount} />
        <StatRow icon={<Link2 className="h-3 w-3" />} label="Links" value={stats.linkCount} />
        <StatRow icon={<Layers className="h-3 w-3" />} label="Max Depth" value={stats.depth} />
        <StatRow icon={<Clock className="h-3 w-3" />} label="Elapsed" value={formatTime(stats.elapsedSeconds)} />
        {stats.errorCount > 0 && (
          <StatRow icon={<AlertCircle className="h-3 w-3 text-red-400" />} label="Errors" value={stats.errorCount} />
        )}
      </div>

      {topCategories.length > 0 && (
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-2">Identifier Types</div>
          <div className="space-y-1">
            {topCategories.map(([type, count]) => (
              <motion.div
                key={type}
                initial={{ opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0 }}
                className="flex items-center gap-2"
              >
                <div className="flex-1 truncate text-xs text-zinc-300">{type}</div>
                <div className="flex items-center gap-1">
                  <div
                    className="h-1.5 rounded-full bg-blue-500"
                    style={{ width: `${Math.max(16, (count / Math.max(...Object.values(stats.byCategory))) * 60)}px` }}
                  />
                  <span className="text-xs font-mono text-zinc-500 w-4 text-right">{count}</span>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      )}

      {stats.status === 'running' && (
        <div className="flex items-center gap-2 text-xs text-blue-400">
          <div className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-pulse" />
          <span>Investigating...</span>
        </div>
      )}
    </div>
  );
}
