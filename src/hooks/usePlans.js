import { useCallback, useEffect, useState } from "react";

// Loads the agent plans and exposes the three request states plus reload().
export default function usePlans(fetchPlans) {
  const [status, setStatus] = useState("loading");
  const [plans, setPlans] = useState([]);
  const [error, setError] = useState(null);
  const [requestId, setRequestId] = useState(0);

  const reload = useCallback(() => {
    setStatus("loading");
    setPlans([]);
    setError(null);
    setRequestId((id) => id + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;

    fetchPlans().then(
      (received) => {
        if (cancelled) return;
        setPlans(received);
        setStatus("ready");
      },
      (failure) => {
        if (cancelled) return;
        setError(failure);
        setStatus("error");
      }
    );

    return () => {
      cancelled = true;
    };
  }, [fetchPlans, requestId]);

  return { status, plans, error, reload };
}
