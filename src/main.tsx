import { StrictMode, Component, ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { AlertTriangle } from 'lucide-react'
import './index.css'
import App from './App'
import { applyDocumentTheme, readPersistedTheme } from './lib/theme'

applyDocumentTheme(readPersistedTheme())

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null }
  static getDerivedStateFromError(error: Error) { return { error } }
  render() {
    if (this.state.error) return (
      <div style={{ padding: 32, textAlign: 'center', fontFamily: 'sans-serif' }}>
        <div style={{ fontSize: 40, marginBottom: 16, display: 'flex', justifyContent: 'center', color: '#ff9500' }}>
          <AlertTriangle size={40} strokeWidth={1.75} aria-hidden />
        </div>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Something went wrong</div>
        <div style={{ fontSize: 13, color: '#888', marginBottom: 24 }}>{(this.state.error as Error).message}</div>
        <button onClick={() => window.location.reload()}
          style={{ padding: '10px 24px', borderRadius: 8, background: '#007aff', color: '#fff', border: 'none', fontWeight: 700, cursor: 'pointer' }}>
          Reload App
        </button>
      </div>
    )
    return this.props.children
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
)
