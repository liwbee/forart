import { useCallback, useEffect, useState } from "react";
import { getLibtvAvailability } from "./libtvGenerationApi";

export interface LibtvAvailabilityState {
  checked: boolean;
  ready: boolean;
  available: boolean;
  loggedIn: boolean;
  error: string;
}

const INITIAL_LIBTV_AVAILABILITY: LibtvAvailabilityState = {
  checked: false,
  ready: false,
  available: false,
  loggedIn: false,
  error: "",
};

export function useLibtvAvailability() {
  const [availability, setAvailability] = useState<LibtvAvailabilityState>(INITIAL_LIBTV_AVAILABILITY);

  const refresh = useCallback(async () => {
    try {
      const result = await getLibtvAvailability();
      setAvailability({
        checked: true,
        ready: result.ready,
        available: result.available,
        loggedIn: result.loggedIn,
        error: result.error || "",
      });
    } catch (error) {
      setAvailability({
        checked: true,
        ready: false,
        available: false,
        loggedIn: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    function handleFocus() {
      void refresh();
    }

    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [refresh]);

  return { ...availability, refresh };
}
