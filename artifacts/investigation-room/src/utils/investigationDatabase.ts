import Dexie, { type Table } from 'dexie';
import type { SavedInvestigation, InvestigationNode, InvestigationEdge, InvestigationStats } from '../types';

/** A cached node is keyed by its cacheKey (not by node.id), so the same node can be cached under different keys. */
type CachedNode = InvestigationNode & { cacheKey: string };

class InvestigationDB extends Dexie {
  investigations!: Table<SavedInvestigation>;
  nodeCacheByKey!: Table<CachedNode, string>;

  constructor() {
    super('InvestigationRoomDB');
    this.version(1).stores({
      investigations: '++id, name, createdAt, updatedAt',
      nodeCache: '++id, cacheKey, timestamp',
    });
    // v2 (P0-005, D-004): v1 used the string node.id as an auto-increment primary key and then cast it to a number
    // when updating. The cache is disposable, so v2 drops it and re-creates it with cacheKey as the primary key.
    this.version(2).stores({
      nodeCache: null,
      nodeCacheByKey: 'cacheKey, timestamp',
    });
  }
}

const db = new InvestigationDB();

export const investigationDatabase = {
  async saveInvestigation(
    name: string,
    nodes: InvestigationNode[],
    edges: InvestigationEdge[],
    stats: InvestigationStats
  ): Promise<string> {
    const id = `inv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();
    await db.investigations.add({
      id,
      name,
      createdAt: now,
      updatedAt: now,
      nodeCount: nodes.length,
      edgeCount: edges.length,
      nodes,
      edges,
      stats,
    });
    return id;
  },

  async loadInvestigation(id: string): Promise<SavedInvestigation | undefined> {
    return db.investigations.get(id);
  },

  async listInvestigations(): Promise<SavedInvestigation[]> {
    return db.investigations.orderBy('updatedAt').reverse().toArray();
  },

  async deleteInvestigation(id: string): Promise<void> {
    await db.investigations.delete(id);
  },

  async renameInvestigation(id: string, name: string): Promise<void> {
    await db.investigations.update(id, { name, updatedAt: Date.now() });
  },

  async updateInvestigation(
    id: string,
    nodes: InvestigationNode[],
    edges: InvestigationEdge[],
    stats: InvestigationStats
  ): Promise<void> {
    await db.investigations.update(id, {
      nodes,
      edges,
      stats,
      nodeCount: nodes.length,
      edgeCount: edges.length,
      updatedAt: Date.now(),
    });
  },

  async cacheNode(cacheKey: string, node: InvestigationNode): Promise<void> {
    // put() upserts by primary key (cacheKey), which removes the old string->number cast entirely.
    await db.nodeCacheByKey.put({ ...node, cacheKey, timestamp: Date.now() });
  },

  async getCachedNode(cacheKey: string): Promise<InvestigationNode | undefined> {
    const cached = await db.nodeCacheByKey.get(cacheKey);
    if (!cached) return undefined;
    const age = Date.now() - (cached.timestamp || 0);
    if (age > 1000 * 60 * 60) return undefined;
    return cached;
  },

  async clearCache(): Promise<void> {
    await db.nodeCacheByKey.clear();
  },

  async getStats(): Promise<{ investigations: number; cachedNodes: number }> {
    const [investigations, cachedNodes] = await Promise.all([
      db.investigations.count(),
      db.nodeCacheByKey.count(),
    ]);
    return { investigations, cachedNodes };
  },
};
