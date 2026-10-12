/**
 * In-process priority queue (5.7, P1). Replaceable by BullMQ/Redis later (ADR-07).
 * Entries with the same priority are dequeued in insertion order (stable).
 */
export interface QueueEntry<T> {
  readonly item: T;
  readonly priority: number;
  readonly seq: number;
}

export class PriorityQueue<T> {
  private heap: QueueEntry<T>[] = [];
  private counter = 0;

  get size(): number {
    return this.heap.length;
  }

  push(item: T, priority = 0): void {
    this.heap.push({ item, priority, seq: this.counter++ });
    this.bubbleUp(this.heap.length - 1);
  }

  pop(): T | undefined {
    if (this.heap.length === 0) return undefined;
    const top = this.heap[0];
    const last = this.heap.pop();
    if (this.heap.length > 0 && last !== undefined) {
      this.heap[0] = last;
      this.bubbleDown(0);
    }
    return top.item;
  }

  peek(): QueueEntry<T> | undefined {
    return this.heap[0];
  }

  private bubbleUp(i: number): void {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.compare(i, parent) >= 0) break;
      [this.heap[i], this.heap[parent]] = [this.heap[parent], this.heap[i]];
      i = parent;
    }
  }

  private bubbleDown(i: number): void {
    const n = this.heap.length;
    for (;;) {
      let smallest = i;
      const l = 2 * i + 1;
      const r = 2 * i + 2;
      if (l < n && this.compare(l, smallest) < 0) smallest = l;
      if (r < n && this.compare(r, smallest) < 0) smallest = r;
      if (smallest === i) return;
      [this.heap[i], this.heap[smallest]] = [this.heap[smallest], this.heap[i]];
      i = smallest;
    }
  }

  private compare(a: number, b: number): number {
    const ha = this.heap[a];
    const hb = this.heap[b];
    if (ha.priority !== hb.priority) return ha.priority - hb.priority;
    return ha.seq - hb.seq;
  }
}
