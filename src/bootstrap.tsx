import React, { lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthRoot, LoadingScreen } from './auth';
import './style.css';

const App = lazy(() => import('./main'));

class AppLoadBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <div className="auth-page"><div className="auth-card">
      <h1>No se pudo abrir Duo Finance</h1><p role="alert">Revisá la conexión e intentá nuevamente.</p>
      <button className="primary-button" onClick={() => location.reload()}>Reintentar</button>
    </div></div>;
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(<React.StrictMode>
  <AuthRoot>{(space, email, userId) => <AppLoadBoundary><Suspense fallback={<LoadingScreen />}>
    <App key={space?.id || 'local'} sharedSpace={space} email={email} userId={userId} />
  </Suspense></AppLoadBoundary>}</AuthRoot>
</React.StrictMode>);
