import { useEffect, useState } from 'react';

/**
 * Minimal hash router: "#/admin" → "admin", "#/account" → "account",
 * anything else (including in-page anchors like "#how") → "home".
 */
function readRoute() {
  const hash = window.location.hash;
  return hash.startsWith('#/') ? hash.slice(2).split(/[/?]/)[0] || 'home' : 'home';
}

export function useHashRoute() {
  const [route, setRoute] = useState(readRoute);

  useEffect(() => {
    const onChange = () => setRoute(readRoute());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  return route;
}

export function navigate(route) {
  window.location.hash = route === 'home' ? '' : `#/${route}`;
  window.scrollTo({ top: 0 });
}
