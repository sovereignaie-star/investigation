// src/utils/investigationDatabase.ts

import Dexie, { Table } from 'dexie';

interface CachedNode {
  id: string;
  identifierType: string;
  identifierValue: string;
  data: any;
  timestamp: number;
}

interface CachedInvestigation {
  id: string;
  name: string;
  rootValue: string;
  graphJson: string;
  createdAt: number;
  updatedAt: number;
  nodeCount: number;
}

class InvestigationDatabase extends Dexie {
  cachedNodes!: Table<CachedNode, string>;
  investigations!: Table<CachedInvestigation, string>;

  constructor() {
    super('InvestigationRoom');
    this.version(1).stores({
      cachedNodes: 'id, identifierType, identifierValue, timestamp',
      investigations: 'id, name, rootValue, createdAt, updatedAt',
    });
  }

  // تخزين نتيجة عقدة
  async cacheNode(node: CachedNode): Promise<void> {
    await this.cachedNodes.put(node);
  }

  // البحث عن عقدة مخزنة
  async getCachedNode(identifierType: string, value: string): Promise<CachedNode | undefined> {
    return this.cachedNodes
      .where('identifierType')
      .equals(identifierType)
      .and(node => node.identifierValue === value)
      .first();
  }

  // تنظيف التخزين المؤقت القديم
  async cleanOldCache(maxAgeDays: number = 7): Promise<number> {
    const cutoff = Date.now() - maxAgeDays * 86400000;
    const oldNodes = await this.cachedNodes
      .where('timestamp')
      .below(cutoff)
      .toArray();
    
    for (const node of oldNodes) {
      await this.cachedNodes.delete(node.id);
    }
    
    return oldNodes.length;
  }

  // حفظ تحقيق كامل
  async saveInvestigation(graph: any, name?: string): Promise<string> {
    const id = `inv-${Date.now()}`;
    const nodeCount = graph.nodes.size || graph.nodes.length || 0;
    
    await this.investigations.put({
      id,
      name: name || `تحقيق - ${new Date().toLocaleString('ar-SA')}`,
      rootValue: graph.rootNodeId || '',
      graphJson: typeof graph === 'string' ? graph : JSON.stringify(graph),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      nodeCount,
    });

    return id;
  }

  // استرجاع تحقيق محفوظ
  async getInvestigation(id: string): Promise<CachedInvestigation | undefined> {
    return this.investigations.get(id);
  }

  // قائمة التحقيقات المحفوظة
  async listInvestigations(): Promise<CachedInvestigation[]> {
    return this.investigations
      .orderBy('updatedAt')
      .reverse()
      .toArray();
  }

  // حذف تحقيق
  async deleteInvestigation(id: string): Promise<void> {
    await this.investigations.delete(id);
  }

  // إحصائيات
  async getStats(): Promise<{
    totalCachedNodes: number;
    totalInvestigations: number;
    totalStorageBytes: number;
  }> {
    const cachedCount = await this.cachedNodes.count();
    const invCount = await this.investigations.count();
    
    // تقدير حجم التخزين
    let totalBytes = 0;
    const allNodes = await this.cachedNodes.toArray();
    const allInvs = await this.investigations.toArray();
    totalBytes += JSON.stringify(allNodes).length;
    totalBytes += JSON.stringify(allInvs).length;

    return {
      totalCachedNodes: cachedCount,
      totalInvestigations: invCount,
      totalStorageBytes: totalBytes,
    };
  }
}

export const investigationDB = new InvestigationDatabase();
