import { useLayoutEffect } from "react";

// Land at the top on mount. Without this a page can inherit the previous
// page's scroll position and open scrolled partway down. useLayoutEffect so
// the reset happens before paint (and before any view-transition snapshot).
//
// Use on detail/form/public pages where opening at the top is always right.
// Deliberately NOT used on the list pages (dashboard, archive, customers,
// opportunities): those rely on the router's scroll restoration so going
// back returns you to where you were in the list. Pages that position
// themselves intentionally (chat centering on the latest message) also
// manage their own scroll.
export function useScrollTopOnMount() {
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, []);
}
