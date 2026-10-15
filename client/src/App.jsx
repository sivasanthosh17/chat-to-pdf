import React, { useEffect } from 'react';
import { Navbar } from './components/Navbar';
import { Icon } from './components/Icon';
import { HomePage } from './pages/HomePage';
import { AdminPage } from './pages/AdminPage';
import { AccountPage } from './pages/AccountPage';
import { useServerHealth } from './hooks/useServerHealth';
import { useAuth } from './hooks/useAuth';
import { useHashRoute, navigate } from './hooks/useHashRoute';

/**
 * Layout + role-based routing:
 *   home     — everyone (converter only when logged in)
 *   account  — logged-in users
 *   admin    — admins only
 * The server enforces the same rules; hiding pages here is only convenience.
 */
export function App() {
  const health = useServerHealth();
  const auth = useAuth();
  const route = useHashRoute();

  const allowed =
    route === 'home' ||
    (route === 'account' && auth.status === 'authenticated') ||
    (route === 'admin' && auth.user?.role === 'admin');

  // Leaving a page you may not see (e.g. after logout) goes back home
  useEffect(() => {
    if (auth.status !== 'loading' && !allowed) navigate('home');
  }, [auth.status, allowed]);

  const logout = async () => {
    await auth.logout();
    navigate('home');
  };

  return (
    <div className="app" id="top">
      <div className="backdrop" aria-hidden="true" />
      <Navbar serverStatus={health.status} onRecheck={health.recheck} user={auth.user} route={route} onLogout={logout} />

      <main className="main">
        {health.status === 'error' && (
          <div className="banner" role="status">
            <Icon name="alert" size={18} />
            <span>
              The conversion server is not reachable. Start the backend (<code>cd server &amp;&amp; npm run dev</code>) and{' '}
              <button type="button" className="link-button" onClick={health.recheck}>check again</button>.
            </span>
          </div>
        )}

        {(route === 'home' || !allowed) && <HomePage auth={auth} />}
        {route === 'account' && allowed && <AccountPage user={auth.user} />}
        {route === 'admin' && allowed && <AdminPage me={auth.user} />}
      </main>

      <footer className="footer">
        <span className="brand-name small">ChatPDF<span>Studio</span></span>
        <span>Conversations are never stored — only your account and a count of your conversions.</span>
      </footer>
    </div>
  );
}

export default App;
