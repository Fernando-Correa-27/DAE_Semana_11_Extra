import { useCallback, useEffect, useRef, useState } from "react";

const IDLE = { status: "idle", plan: null, result: null, error: null };

// State machine for running an agent plan: R2 plans wait for an explicit approval.
export default function useAgentRun(runAgent) {
  const [state, setState] = useState(IDLE);
  const stateRef = useRef(state);
  const controllerRef = useRef(null);

  const apply = useCallback((next) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const start = useCallback(
    (plan) => {
      const { status } = stateRef.current;
      if (!runAgent || status === "running" || status === "awaiting_approval") return;

      const controller = new AbortController();
      controllerRef.current = controller;
      apply({ status: "running", plan, result: null, error: null });

      runAgent(plan, { signal: controller.signal }).then(
        (result) => {
          if (controller.signal.aborted) return;
          controllerRef.current = null;
          apply({
            status: plan.risk === "R2" ? "awaiting_approval" : "done",
            plan,
            result,
            error: null,
          });
        },
        (error) => {
          if (controller.signal.aborted) return;
          controllerRef.current = null;
          apply({ status: "error", plan, result: null, error });
        }
      );
    },
    [apply, runAgent]
  );

  const approve = useCallback(() => {
    if (stateRef.current.status !== "awaiting_approval") return;
    apply({ ...stateRef.current, status: "done" });
  }, [apply]);

  const reject = useCallback(() => {
    const current = stateRef.current;
    if (current.status !== "running" && current.status !== "awaiting_approval") return;
    if (current.status === "running") controllerRef.current?.abort();
    controllerRef.current = null;
    apply(IDLE);
  }, [apply]);

  useEffect(() => {
    return () => {
      controllerRef.current?.abort();
    };
  }, []);

  return { ...state, start, approve, reject };
}
