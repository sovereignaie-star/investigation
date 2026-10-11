import { describe, expect, it } from "vitest";
import { PriorityQueue } from "./queue.ts";

describe("PriorityQueue", () => {
  it("dequeues in priority order", () => {
    const q = new PriorityQueue<number>();
    q.push(3, 2);
    q.push(1, 0);
    q.push(2, 1);
    expect([q.pop(), q.pop(), q.pop()]).toEqual([1, 2, 3]);
  });

  it("is stable for equal priorities", () => {
    const q = new PriorityQueue<string>();
    q.push("a", 1);
    q.push("b", 1);
    q.push("c", 1);
    expect([q.pop(), q.pop(), q.pop()]).toEqual(["a", "b", "c"]);
  });

  it("pops undefined when empty", () => {
    const q = new PriorityQueue<number>();
    expect(q.pop()).toBeUndefined();
    expect(q.size).toBe(0);
  });

  it("handles interleaved push/pop", () => {
    const q = new PriorityQueue<string>();
    q.push("low", 5);
    q.push("high", 0);
    expect(q.pop()).toBe("high");
    q.push("mid", 2);
    expect(q.pop()).toBe("mid");
    expect(q.pop()).toBe("low");
  });
});
