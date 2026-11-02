export type Limiter = <T>(task: () => Promise<T>) => Promise<T>;

/** Limits how many async tasks run at once (keeps us polite with upstream APIs). */
export function createLimiter(concurrency: number): Limiter {
  let active = 0;
  const queue: (() => void)[] = [];

  const next = (): void => {
    if (active >= concurrency) return;
    const run = queue.shift();
    if (run) run();
  };

  return <T>(task: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const run = (): void => {
        active++;
        task()
          .then(resolve, reject)
          .finally(() => {
            active--;
            next();
          });
      };
      queue.push(run);
      next();
    });
}
