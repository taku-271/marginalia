/**
 * 画面が表示されている時間だけを数えるストップウォッチ。
 * document.visibilityState === "hidden" の間は止まる。
 * secondsToAnswer / secondsToSkip / secondsViewed の計測に使う。
 */

export interface StopwatchEnv {
  now: () => number;
  isHidden: () => boolean;
  onVisibilityChange: (cb: () => void) => () => void;
}

export const browserStopwatchEnv = (): StopwatchEnv => ({
  now: () => performance.now(),
  isHidden: () => document.visibilityState === "hidden",
  onVisibilityChange: (cb) => {
    document.addEventListener("visibilitychange", cb);
    return () => document.removeEventListener("visibilitychange", cb);
  },
});

export class VisibleStopwatch {
  private accumulatedMs = 0;
  private runningSince: number | null = null;
  private unsubscribe: (() => void) | null = null;
  private stopped = false;

  constructor(private readonly env: StopwatchEnv = browserStopwatchEnv()) {
    if (!env.isHidden()) this.runningSince = env.now();
    this.unsubscribe = env.onVisibilityChange(() => this.handleVisibility());
  }

  private handleVisibility() {
    if (this.stopped) return;
    if (this.env.isHidden()) this.pause();
    else if (this.runningSince === null) this.runningSince = this.env.now();
  }

  private pause() {
    if (this.runningSince !== null) {
      this.accumulatedMs += this.env.now() - this.runningSince;
      this.runningSince = null;
    }
  }

  /** 経過秒(小数第1位まで) */
  get seconds(): number {
    const running = this.runningSince === null ? 0 : this.env.now() - this.runningSince;
    return Math.round((this.accumulatedMs + running) / 100) / 10;
  }

  /** 止めて経過秒を返す。以後は加算しない */
  stop(): number {
    if (!this.stopped) {
      this.pause();
      this.stopped = true;
      this.unsubscribe?.();
      this.unsubscribe = null;
    }
    return this.seconds;
  }
}
