import React from 'react'
import ReactDOM from 'react-dom/client'
import { RevenueDashboard } from './pages/RevenueDashboard'

ReactDOM.createRoot(document.getElementById('dash-root')!).render(
  <React.StrictMode>
    <RevenueDashboard />
  </React.StrictMode>
)
