/**
 * Lightweight per-frame stage timing. Stages accumulate samples; a summary
 * (count / mean / p95 / max, in milliseconds) prints periodically and at
 * shutdown. Always safe to call — marks are no-ops unless enabled.
 */

export interface StageStat {
  count: number;
  totalMs: number;
  maxMs: number;
  samples: number[]; // ring buffer for percentile (bounded)
}

const RING = 240; // ~2.7s of history at 90fps, plenty for p95

export class FrameTiming {
  private enabled: boolean;
  private readonly stages = new Map<string, StageStat>();
  frames = 0;
  skipped = 0;
  /** Runtime's target frame period (from xrWaitFrame predictedDisplayPeriod). */
  targetFramePeriodMs = 0;
  private frameStart = 0;
  private lastLocateMs = 0;
  poseStalenessMs: StageStat = { count: 0, totalMs: 0, maxMs: 0, samples: [] };

  constructor(enabled: boolean) {
    this.enabled = enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  beginFrame(): void {
    if (!this.enabled) return;
    this.frames++;
    this.frameStart = performance.now();
  }

  /** Time a synchronous stage. */
  stage<T>(name: string, fn: () => T): T {
    if (!this.enabled) return fn();
    const t0 = performance.now();
    try {
      return fn();
    } finally {
      this.record(name, performance.now() - t0);
    }
  }

  /** Time a stage that may return a value or a promise for one. */
  async stageAsync<T>(name: string, fn: () => T | Promise<T>): Promise<T> {
    if (!this.enabled) return await fn();
    const t0 = performance.now();
    try {
      return await fn();
    } finally {
      this.record(name, performance.now() - t0);
    }
  }

  /** Mark view poses located (start of the pose-staleness window). */
  locatedViews(): void {
    if (!this.enabled) return;
    this.lastLocateMs = performance.now();
  }

  /** Called at xrEndFrame: closes the pose-staleness window. */
  endedFrame(): void {
    if (!this.enabled) return;
    this.record("frameTotal", performance.now() - this.frameStart);
    if (this.lastLocateMs > 0) {
      const delta = performance.now() - this.lastLocateMs;
      const stat = this.poseStalenessMs;
      stat.count++;
      stat.totalMs += delta;
      stat.maxMs = Math.max(stat.maxMs, delta);
      stat.samples.push(delta);
      if (stat.samples.length > RING) stat.samples.shift();
    }
  }

  countSkipped(): void {
    if (this.enabled) this.skipped++;
  }

  private record(name: string, ms: number): void {
    let stat = this.stages.get(name);
    if (stat === undefined) {
      stat = { count: 0, totalMs: 0, maxMs: 0, samples: [] };
      this.stages.set(name, stat);
    }
    stat.count++;
    stat.totalMs += ms;
    stat.maxMs = Math.max(stat.maxMs, ms);
    stat.samples.push(ms);
    if (stat.samples.length > RING) stat.samples.shift();
  }

  summary(): string {
    if (this.frames === 0) return "no frames";
    const line = (name: string, stat: StageStat): string => {
      const mean = stat.totalMs / stat.count;
      const p95 = percentile(stat.samples, 0.95);
      return `${name.padEnd(14)} mean ${mean.toFixed(2).padStart(7)}ms  p95 ${p95.toFixed(2).padStart(7)}ms  max ${stat.maxMs.toFixed(2).padStart(7)}ms  n=${stat.count}`;
    };
    const achievedFps = this.frames / (this.frames > 0 ? this.uptimeFramesSeconds() : 1);
    const target = this.targetFramePeriodMs > 0 ? ` (runtime target ${(1000 / this.targetFramePeriodMs).toFixed(0)} fps)` : "";
    const lines = [
      `frames=${this.frames} skipped=${this.skipped} avg ${achievedFps.toFixed(1)} fps${target}`,
      ...[...this.stages.entries()].map(([name, stat]) => line(name, stat)),
    ];
    if (this.poseStalenessMs.count > 0) lines.push(line("poseStaleness", this.poseStalenessMs));
    return lines.join("\n");
  }

  private firstFrameAt = 0;
  private lastFrameAt = 0;

  /** Track wall-time span for the achieved-fps figure. */
  frameWallClock(): void {
    if (!this.enabled) return;
    if (this.firstFrameAt === 0) this.firstFrameAt = performance.now();
    this.lastFrameAt = performance.now();
  }

  private uptimeFramesSeconds(): number {
    const span = (this.lastFrameAt - this.firstFrameAt) / 1000;
    return span > 0 ? span : 1;
  }
}

function percentile(samples: number[], p: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[index];
}
