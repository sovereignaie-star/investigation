import { useEffect, useState } from "react";
import { setAuthTokenGetter } from "@workspace/api-client-react";

/**
 * P3-015/D-033/D-037: the admin token is memory-only for the whole app session.
 * One module-level ref backs every surface that asks for it (the run panel, the
 * saved-investigations list, the cases screen) — entering it once in any of
 * them authenticates all of them, and nothing is ever written to the browser
 * storage. The generated client's auth getter is installed exactly once and
 * reads this ref, so whichever surface mounts last cannot shadow the others.
 */

const tokenRef = { current: "" };

let getterInstalled = false;
function installGetter(): void {
  if (getterInstalled) return;
  getterInstalled = true;
  setAuthTokenGetter(() => (tokenRef.current === "" ? null : tokenRef.current));
}

export function useAdminToken(): [string, (value: string) => void] {
  const [token, setToken] = useState(tokenRef.current);
  useEffect(() => {
    installGetter();
  }, []);
  const save = (value: string): void => {
    tokenRef.current = value;
    setToken(value);
  };
  return [token, save];
}
