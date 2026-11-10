export const THUMB_CONCURRENCY = 6;
export const THUMB_RETRIES = 3;

export function thumbSources(id: string): string[] {
  const encoded = encodeURIComponent(id);
  return [
    `https://drive.google.com/thumbnail?id=${encoded}&sz=w400`,
    `https://lh3.googleusercontent.com/d/${encoded}=w400`,
  ];
}

export function retryDelayMs(attempt: number): number {
  return 250 * 2 ** attempt;
}

/** Limits how many card images hit Drive at once. */
export class ThumbGate {
  private active = 0;
  private queue: Array<() => void> = [];
  private limit: number;

  constructor(limit = THUMB_CONCURRENCY) {
    this.limit = limit;
  }

  acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.queue.push(() => {
        this.active += 1;
        resolve();
      });
    });
  }

  release(): void {
    this.active = Math.max(0, this.active - 1);
    const next = this.queue.shift();
    if (next) next();
  }
}

export const thumbGate = new ThumbGate();

/** Larger copy of a thumbnail for the desktop card flyout. Same hosts and id as thumbSources. */
export function largeThumbSources(id: string): string[] {
  const encoded = encodeURIComponent(id);
  return [
    `https://drive.google.com/thumbnail?id=${encoded}&sz=w800`,
    `https://lh3.googleusercontent.com/d/${encoded}=w800`,
  ];
}
