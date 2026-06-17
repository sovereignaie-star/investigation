import Dexie, { Table } from 'dexie';
import type { CachedNode, SavedInvestigation } from '../types';

class InvestigationDatabase extends Dexie {
  cachedNodes!: Table<CachedNode, string>;
  investigations!: Table<SavedInvestigation, string>;

  constructor() {
    super('InvestigationRoomDB');
    this.version(1).stores({
      cachedNodes: 'id, identifierType, identifierValue, timestamp',
      investigations: 'id, name, rootValue, createdAt, updatedAt',
    });
  }

  async cacheNode(node: CachedNode): Promise<void> {
    await this.cachedNodes.put(node);
  }

  async getCachedNode(identifierType: string, value: string): Promise<CachedNode | undefined> {
    return this.cachedNodes
      .where('identifierType').equals(identifierType)
      .and(n => n.identifierValue === value)
      .first();
  }

  async cleanOldCache(maxAgeDays = 7): Promise<number> {
    const cutoff = Date.now() - maxAgeDays * 86400000;
    const old = await this.cachedNodes.where('timestamp').below(cutoff).toArray();
    for (const n of old) await this.cachedNodes.delete(n.id);
    return old.length;
  }

  async saveInvestigation(graphJson: string, name?: string, rootValue = '', nodeCount = 0): Promise<string> {
    const id = `inv-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const now = Date.now();
    await this.investigations.put({
      id,
      name: name || `Investigation — ${new Date(now).toLocaleString()}`,
      rootValue,
      graphJson,
      createdAt: now,
      updatedAt: now,
      nodeCount,
    });
    return id;
  }

  async updateInvestigation(id: string, patch: Partial<SavedInvestigation>): Promise<void> {
    await this.investigations.update(id, { ...patch, updatedAt: Date.now() });
  }

  async getInvestigation(id: string): Promise<SavedInvestigation | undefined> {
    return this.investigations.get(id);
  }

  async listInvestigations(): Promise<SavedInvestigation[]> {
    return this.investigations.orderBy('updatedAt').reverse().toArray();
  }

  async deleteInvestigation(id: string): Promise<void> {
    await this.investigations.delete(id);
  }

  async getStats() {
    const cachedCount = await this.cachedNodes.count();
    const invCount = await this.investigations.count();
    const allNodes = await this.cachedNodes.toArray();
    const allInvs = await this.investigations.toArray();
    const totalBytes = JSON.stringify(allNodes).length + JSON.stringify(allInvs).length;
    return { totalCachedNodes: cachedCount, totalInvestigations: invCount, totalStorageBytes: totalBytes };
  }
}

export const investigationDB = new InvestigationDatabase();
