import { useEffect, useState } from "react";
import { loadDeployment } from "../lib/deployment";

export function useDeployment() {
  const [deployment, setDeployment] = useState(null);

  useEffect(() => {
    let cancelled = false;

    loadDeployment()
      .then((nextDeployment) => {
        if (!cancelled) {
          setDeployment(nextDeployment);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDeployment(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return deployment;
}
