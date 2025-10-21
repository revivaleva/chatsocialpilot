type Job = { id: string; kind: string; payload: any };
type Handler = (job: Job) => Promise<void>;

export class MemoryQueue {
  private q: Job[] = [];
  private handlers = new Map<string, Handler>();
  private running = 0;
  constructor(private concurrency = 4) {}

  register(kind: string, handler: Handler) { this.handlers.set(kind, handler); }
  enqueue(job: Job) { this.q.push(job); this.pump(); }
  setConcurrency(n: number) { this.concurrency = Math.max(1, n); }

  private pump() {
    while (this.running < this.concurrency && this.q.length > 0) {
      const job = this.q.shift()!;
      const h = this.handlers.get(job.kind); if (!h) continue;
      this.running++;
      h(job).catch(() => {}).finally(() => { this.running--; this.pump(); });
    }
  }
}


