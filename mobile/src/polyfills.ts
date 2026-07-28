/**
 * Loaded before anything else (first import in index.ts).
 *
 * React Native defines `window` (as the global object) but none of the DOM
 * event APIs. Convex Auth's session manager guards on `typeof window` alone
 * before wiring its cross-tab storage listener — pointless on native, but
 * the call would throw "undefined is not a function" during init(). Give it
 * no-ops. (Upstream fix: guard on `typeof window.addEventListener`.)
 */
if (
  typeof window !== "undefined" &&
  typeof window.addEventListener !== "function"
) {
  (window as any).addEventListener = () => {};
  (window as any).removeEventListener = () => {};
}

export {};
