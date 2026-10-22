import { useEffect, type ReactElement } from "react";
import { useNotifier } from "../notifications/context.js";

const EVENT = "dashdialer:api-forbidden";

export type ApiForbiddenDetail = { message?: string; path?: string };

/** Surfaces backend 403 as a friendly toast (not a stack trace). */
export function ApiForbiddenListener(): ReactElement | null {
  const { pushToast } = useNotifier();

  useEffect(() => {
    function onForbidden(ev: Event): void {
      const detail = (ev as CustomEvent<ApiForbiddenDetail>).detail ?? {};
      pushToast({
        variant: "error",
        title: "Access denied",
        message:
          detail.message?.replace(/^Access denied for \w+/, "You don't have permission for that") ||
          "You don't have permission for that. Ask your Owner if you need access.",
      });
    }
    window.addEventListener(EVENT, onForbidden);
    return () => window.removeEventListener(EVENT, onForbidden);
  }, [pushToast]);

  return null;
}

export function dispatchApiForbidden(detail: ApiForbiddenDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVENT, { detail }));
}
