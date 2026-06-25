import React from 'react'
import ReactDOM from 'react-dom/client'
import LearnFlow from './LearnFlow.jsx'
import { supabase } from './supabase.js'
import './index.css'

async function bootNative() {
  try {
    const { Capacitor } = await import('@capacitor/core')
    if (!Capacitor.isNativePlatform()) return

    const [{ StatusBar, Style }, { SplashScreen }] = await Promise.all([
      import('@capacitor/status-bar'),
      import('@capacitor/splash-screen'),
    ])

    await StatusBar.setStyle({ style: Style.Dark }).catch(() => {})
    await StatusBar.setBackgroundColor({ color: '#080C16' }).catch(() => {})

    document.addEventListener('deviceready', () => {
      SplashScreen.hide({ fadeOutDuration: 400 }).catch(() => {})
    }, { once: true })
    setTimeout(() => SplashScreen.hide({ fadeOutDuration: 400 }).catch(() => {}), 500)

    // Register for push notifications and save token to Supabase
    await registerPushNotifications(Capacitor.getPlatform())
  } catch {
    // Not a Capacitor build
  }
}

async function registerPushNotifications(platform) {
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications')

    const perm = await PushNotifications.requestPermissions()
    if (perm.receive !== 'granted') return

    await PushNotifications.register()

    PushNotifications.addListener('registration', async ({ value: token }) => {
      if (!supabase) return
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      // Determine if this is a sandbox (dev) build
      const sandbox = import.meta.env.DEV || import.meta.env.MODE !== 'production'
      await supabase.from('device_tokens').upsert(
        { user_id: user.id, token, platform, sandbox },
        { onConflict: 'user_id,token' }
      ).catch(() => {})
    })

    PushNotifications.addListener('registrationError', (err) => {
      console.warn('[WinTrail] Push registration error:', err)
    })

    // When user taps a notification while app is backgrounded/closed
    PushNotifications.addListener('pushNotificationActionPerformed', () => {
      // The app is now in foreground — nothing extra needed
    })
  } catch (err) {
    console.warn('[WinTrail] Push notifications unavailable:', err?.message)
  }
}

bootNative()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <LearnFlow />
  </React.StrictMode>,
)
