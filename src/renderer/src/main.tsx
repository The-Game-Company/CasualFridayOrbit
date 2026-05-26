import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

// No StrictMode: each session mount spawns a real `claude` PTY, and StrictMode's
// dev-only double-invoke would spawn/kill them twice.
createRoot(document.getElementById('root')!).render(<App />)
