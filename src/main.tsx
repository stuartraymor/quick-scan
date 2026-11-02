// SPDX-License-Identifier: AGPL-3.0-only
// The app's stylesheet first: a plugin's own stylesheet, loaded with the
// plugin, builds on it and has to come after it.
import './styles.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { installPlugins } from './plugins/registry'
import { installSystemLog } from './app/systemLog'
import { APP_VERSION } from './version'
import { installDocumentOrder } from './state/documentOrderStore'

// Before anything renders: what the plugins register is part of the app
// from its first frame.
installDocumentOrder()
installPlugins()
installSystemLog(APP_VERSION)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

import './ui/desktop-shell.css'
