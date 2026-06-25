import React from 'react'
import ReactDOM from 'react-dom/client'
import LearnFlow from './LearnFlow.jsx'
import './index.css'

// Capacitor native plugin bootstrap — runs only in the native iOS/Android shell.
// On web, Capacitor stubs these so they're no-ops.
async function bootNative() {
  try {
    const { Capacitor } = await import('@capacitor/core')
    if (!Capacitor.isNativePlatform()) return

    const [{ StatusBar, Style }, { SplashScreen }] = await Promise.all([
      import('@capacitor/status-bar'),
      import('@capacitor/splash-screen'),
    ])

    // Dark status bar (matches our dark splash + nav)
    await StatusBar.setStyle({ style: Style.Dark }).catch(() => {})
    await StatusBar.setBackgroundColor({ color: '#080C16' }).catch(() => {})

    // Hide splash after React renders — wait for 'deviceready' on Android
    document.addEventListener('deviceready', () => {
      SplashScreen.hide({ fadeOutDuration: 400 }).catch(() => {})
    }, { once: true })
    // iOS fires immediately
    setTimeout(() => SplashScreen.hide({ fadeOutDuration: 400 }).catch(() => {}), 500)
  } catch {
    // Not a Capacitor build — safe to ignore
  }
}

bootNative()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <LearnFlow />
  </React.StrictMode>,
)
