import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './styles/app.css'
import App from './App.tsx'
import { logError } from './state/appStore'

window.addEventListener('error', (e) => logError(e.error ?? e.message))
window.addEventListener('unhandledrejection', (e) => logError(e.reason))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
