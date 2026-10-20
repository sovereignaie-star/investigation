import { useEffect, useState } from "react";
import { setAuthTokenGetter } from "@workspace/api-client-react";

/**
 * P3-015/D-033/D-037: the admin token is memory-only for the whole app session.
 * One module-level ref backs every surface that asks for it (the run panel, the
 * saved-investigations list, the cases screen) — entering it once in any of
 * them authenticates all of them, and nothing is ever written to the browser
 * storage. The generated client's auth getter is installed ONCE, at module load,
 * and always reads this ref: no page that mounts later can shadow it with its
 * own dead ref (the one-ref contract of the app's auth boundary).
 */

const tokenRef = { current: "" };

setAuthTokenGetter(() => (tokenRef.current === "" ? null : tokenRef.current));

export function useAdminToken(): [string, (value: string) => void] {
  const [token, setToken] = useState(tokenRef.current);
  useEffect(() => {
    // Keeps a mounted surface in sync if another surface writes the shared ref.
    setToken(tokenRef.current);
  }, []);
  const save = (value: string): void => {
    tokenRef.current = value;
    setToken(value);
  };
  return [token, save];
}
