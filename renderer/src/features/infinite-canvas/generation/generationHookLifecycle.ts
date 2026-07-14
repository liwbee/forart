interface MountedRef {
  current: boolean;
}

export function activateGenerationHook(mountedRef: MountedRef, cleanup: () => void) {
  mountedRef.current = true;

  return () => {
    mountedRef.current = false;
    cleanup();
  };
}
