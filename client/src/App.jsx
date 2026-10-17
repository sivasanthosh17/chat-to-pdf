import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Navbar } from './components/Navbar';
import { Icon } from './components/Icon';
import { AuthDialog } from './components/AuthCard';
import { HomePage } from './pages/HomePage';
import { AdminPage } from './pages/AdminPage';
import { AccountPage } from './pages/AccountPage';
import { useServerHealth } from './hooks/useServerHealth';
import { useAuth } from './hooks/useAuth';
import { useHashRoute, navigate } from './hooks/useHashRoute';

/**
 * Layout + role-based routing:
 *   home     — everyone; converting and previewing ask for a login first
 *   account  — logged-in users
 *   admin    — admins only
 * The server enforces the same rules; the UI only decides when to ask.
 */
export function App() {
  const health = useServerHealth();
  const auth = useAuth();
  const route = useHashRoute();

  // Log-in dialog, plus the action to continue with once logged in
  const [authPrompt, setAuthPrompt] = useState(null); // { mode, reason } | null
  const pendingRef = useRef(null);

  // The converter (and its in-tab history of PDFs) restarts when the account
  // changes, so one person's PDFs never stay visible to the next.
  const [converterEpoch, setConverterEpoch] = useState(0);
  const ownerRef = useRef(null);
  useEffect(() => {
    if (auth.user) ownerRef.current = auth.user.id;
  }, [auth.user]);

  const allowed =
    route === 'home' ||
    (route === 'account' && auth.status === 'authenticated') ||
    (route === 'admin' && auth.user?.role === 'admin');

  // Leaving a page you may not see (e.g. after logout) goes back home
  useEffect(() => {
    if (auth.status !== 'loading' && !allowed) navigate('home');
  }, [auth.status, allowed]);

  /** Opens the log-in dialog; `action` runs after a successful login. */
  const promptLogin = useCallback((action, reason) => {
    pendingRef.current = action || null;
    setAuthPrompt({ mode: 'login', reason });
  }, []);

  /** Runs `action` now if logged in, otherwise asks to log in first and then runs it. */
  const requireLogin = useCallback((action, reason) => {
    if (auth.status === 'authenticated') action();
    else promptLogin(action, reason);
  }, [auth.status, promptLogin]);

  /** The server said the session ended (expired, logged out elsewhere, disabled). */
  const onSessionExpired = useCallback((retry) => {
    auth.refresh();
    promptLogin(retry, 'to continue — your session has ended');
  }, [auth, promptLogin]);

  const closePrompt = () => {
    pendingRef.current = null;
    setAuthPrompt(null);
  };

  const afterAuth = (result) => {
    if (!result.ok) return result;
    if (ownerRef.current && ownerRef.current !== result.data.user.id) setConverterEpoch((n) => n + 1);
    ownerRef.current = result.data.user.id;
    const action = pendingRef.current;
    pendingRef.current = null;
    setAuthPrompt(null);
    if (action) {
      // Continue what the visitor started (convert / preview) as soon as the
      // dialog has closed — even for admins, since that is what they asked for
      setTimeout(action, 0);
    } else if (result.data.user.role === 'admin') {
      // A plain login by an admin lands on the dashboard
      navigate('admin');
    }
    return result;
  };

  const logout = async () => {
    await auth.logout();
    ownerRef.current = null;
    setConverterEpoch((n) => n + 1);
    navigate('home');
  };

  return (
    <div className="app" id="top">
      <div className="backdrop" aria-hidden="true" />
      <Navbar
        serverStatus={health.status}
        onRecheck={health.recheck}
        user={auth.user}
        authStatus={auth.status}
        route={route}
        onLogout={logout}
        onLogin={() => setAuthPrompt({ mode: 'login' })}
        onSignup={() => setAuthPrompt({ mode: 'signup' })}
      />

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

        {(route === 'home' || !allowed) && (
          <HomePage
            auth={auth}
            converterKey={converterEpoch}
            requireLogin={requireLogin}
            onSessionExpired={onSessionExpired}
          />
        )}
        {route === 'account' && allowed && <AccountPage user={auth.user} quota={auth.quota} />}
        {route === 'admin' && allowed && <AdminPage me={auth.user} />}
      </main>

      {authPrompt && (
        <AuthDialog
          key={authPrompt.mode}
          initialMode={authPrompt.mode}
          reason={authPrompt.reason}
          signupAllowed={auth.signupAllowed}
          onLogin={async (email, password) => afterAuth(await auth.login(email, password))}
          onSignup={async (email, password) => afterAuth(await auth.signup(email, password))}
          onClose={closePrompt}
        />
      )}

      <footer className="footer">
        <span className="brand-name small">ChatPDF<span>Studio</span></span>
        <span>Conversations are never stored — only your account and a count of your conversions.</span>
      </footer>
    </div>
  );
}

export default App;
