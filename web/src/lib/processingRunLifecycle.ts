/** A pending Process run cannot donate workers after its component unmounts. */
export function createProcessingRunLifecycle() {
  let generation = 0;
  let mounted = true;
  const isCurrent = (token: number) => mounted && token === generation;
  return {
    token: () => generation,
    isCurrent,
    mount: () => { mounted = true; },
    unmount: () => { mounted = false; generation += 1; },
    retain: (
      token: number,
      pool: { terminate: () => void },
      keep: () => void,
    ): boolean => {
      if (!isCurrent(token)) {
        pool.terminate();
        return false;
      }
      keep();
      return true;
    },
  };
}
