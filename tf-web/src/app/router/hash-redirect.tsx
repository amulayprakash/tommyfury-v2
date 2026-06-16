import { useEffect } from "react";
import { useNavigate } from "react-router";

/**
 * The legacy app used HashRouter, so links like
 * https://site/#/PetHome are still out in the wild (emails, bookmarks,
 * payment-gateway return URLs). On load, translate `#/path` to `/path`.
 */
export function HashRedirect() {
  const navigate = useNavigate();

  useEffect(() => {
    const { hash } = window.location;
    if (hash.startsWith("#/")) {
      void navigate(hash.slice(1), { replace: true });
    }
  }, [navigate]);

  return null;
}
