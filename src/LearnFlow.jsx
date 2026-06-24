import React from 'react'
import { supabase } from './supabase.js'

const e = React.createElement

// Convert an inline CSS string into a React style object (supports template literals).
const S = (str) => {
  const o = {}
  String(str).split(';').forEach((part) => {
    const i = part.indexOf(':')
    if (i < 0) return
    let k = part.slice(0, i).trim()
    const val = part.slice(i + 1).trim()
    if (!k || !val) return
    k = k.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
    o[k] = val
  })
  return o
}

export default class LearnFlow extends React.Component {
  state = {
    theme: 'light',
    screen: 'landing',
    obStep: 1,
    obData: { topic: '', level: '', goal: '', time: '' },
    obPhase: 'question', // question | generating | done
    obGenIdx: 0,
    faqOpen: 0,
    chatInput: '',
    chatMsgs: [],
    chatTyping: false,
    roadmapPhase: 1,
    plannerView: 'week',
    libraryFilter: 'All',
    roadmap: null,
    tasks: null,
    progress: { streak: 0, hoursStudied: 0, lastDate: null, dates: [] },
    userName: '',
    user: null,
    authMode: 'signup',
    authName: '',
    authEmail: '',
    authPassword: '',
    authError: '',
    authLoading: false,
    sessionLoading: true,
    obCustom: '',       // custom topic text in onboarding step 1
    settings: {
      reduceMotion: false, celebrateMilestones: false, autoSchedule: false,
      dailyReminder: true, streakAlerts: true, weeklyReview: true,
      groundedAnswers: true, proactiveCoaching: true,
    },
  }

  selectPhase(i) { return () => this.setState({ roadmapPhase: i }) }
  setPlannerView(v) { return () => this.setState({ plannerView: v }) }
  setLibraryFilter(f) { return () => this.setState({ libraryFilter: f }) }

  // ---------- LIFECYCLE ----------
  componentDidMount() {
    if (supabase) {
      // onAuthStateChange fires immediately with current session then on every change
      const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
        if (session && !this.state.user) {
          this.setState({ user: session.user, sessionLoading: false })
          this.loadFromSupabase(session.user.id)
        } else if (!session && event !== 'INITIAL_SESSION') {
          // SIGNED_OUT — already handled by doSignOut; just clear loading
          this.setState({ sessionLoading: false })
        } else if (!session) {
          this.setState({ sessionLoading: false })
          this._restoreLocal()
        }
      })
      this._authSub = subscription
    } else {
      this.setState({ sessionLoading: false })
      this._restoreLocal()
    }
  }

  _restoreLocal() {
    try {
      const saved = JSON.parse(localStorage.getItem('lf_state') || 'null')
      if (saved) {
        const patch = {}
        if (saved.theme) patch.theme = saved.theme
        if (saved.roadmap) patch.roadmap = saved.roadmap
        if (saved.chatMsgs && saved.chatMsgs.length) patch.chatMsgs = saved.chatMsgs
        if (saved.obData && saved.obData.topic) { patch.obData = saved.obData; patch.obPhase = 'done' }
        if (saved.tasks) patch.tasks = saved.tasks
        if (saved.progress) patch.progress = { ...{ streak: 0, hoursStudied: 0, lastDate: null, dates: [] }, ...saved.progress }
        if (saved.userName) patch.userName = saved.userName
        if (saved.settings) patch.settings = { ...this.state.settings, ...saved.settings }
        if (saved.screen && !['landing', 'onboarding', 'auth'].includes(saved.screen)) patch.screen = saved.screen
        if (Object.keys(patch).length) this.setState(patch)
      }
    } catch { /* ignore */ }
  }

  componentDidUpdate(_, prevState) {
    if (this._saveTimer) clearTimeout(this._saveTimer)
    this._saveTimer = setTimeout(() => {
      try {
        const { theme, roadmap, chatMsgs, obData, screen, tasks, progress, userName, settings } = this.state
        localStorage.setItem('lf_state', JSON.stringify({ theme, roadmap, chatMsgs, obData, screen, tasks, progress, userName, settings }))
      } catch { /* ignore */ }
    }, 300)
    // Debounced Supabase sync (1 s) when logged in
    if (this._syncTimer) clearTimeout(this._syncTimer)
    this._syncTimer = setTimeout(() => this._saveToSupabase(), 1000)
  }

  componentWillUnmount() {
    if (this._t) clearTimeout(this._t)
    if (this._g) clearInterval(this._g)
    if (this._saveTimer) clearTimeout(this._saveTimer)
    if (this._syncTimer) clearTimeout(this._syncTimer)
    if (this._authSub) this._authSub.unsubscribe()
  }

  go(screen) {
    return () => {
      this.setState({ screen })
      const m = document.querySelector('main.lf-scroll')
      if (m) m.scrollTop = 0
    }
  }

  // ---------- ONBOARDING ----------
  obSelect(key, val, next) {
    return () => {
      const obData = { ...this.state.obData, [key]: val }
      if (next === 'generate') {
        this._obAnimDone = false
        this._roadmapReady = false
        this.setState({ obData, obPhase: 'generating', obGenIdx: 0 })

        // Fire real roadmap generation in parallel with the animation.
        // When both finish (whichever is last), transition to 'done'.
        const finalize = () => {
          if (this._obAnimDone && this._roadmapReady) {
            this._t = setTimeout(() => this.setState({ obPhase: 'done' }), 400)
          }
        }
        fetch('/api/roadmap', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(obData),
        })
          .then((r) => r.json())
          .then((data) => {
            if (data && Array.isArray(data.phases) && data.phases.length > 0) {
              this.setState({ roadmap: data, tasks: Array.isArray(data.todaysTasks) ? data.todaysTasks : null })
            }
          })
          .catch(() => { /* no key or error — fall back to mock data silently */ })
          .finally(() => { this._roadmapReady = true; finalize() })

        this._g = setInterval(() => {
          this.setState((s) => {
            const i = s.obGenIdx + 1
            if (i >= 5) {
              clearInterval(this._g)
              this._obAnimDone = true
              finalize()
              return { obGenIdx: 5 }
            }
            return { obGenIdx: i }
          })
        }, 650)
      } else {
        this.setState({ obData, obStep: next })
      }
    }
  }
  obBack() { this.setState((s) => ({ obStep: Math.max(1, s.obStep - 1) })) }

  // ---------- CHAT ----------
  onChatInput(ev) { this.setState({ chatInput: ev.target.value }) }
  onChatKey(ev) { if (ev.key === 'Enter') { this.doSend() } }
  send(text) { return () => this.doSend(text) }
  async doSend(forced) {
    const text = (forced || this.state.chatInput || '').trim()
    if (!text) return
    const history = [...this.state.chatMsgs, { role: 'user', text }]
    this.setState((s) => ({ chatMsgs: [...s.chatMsgs, { role: 'user', text }], chatInput: '', chatTyping: true }))
    try {
      const res = await fetch('/api/mentor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          context: this.mentorContext(),
          messages: history.slice(-10).map((m) => ({ role: m.role === 'ai' ? 'assistant' : 'user', content: m.text })),
        }),
      })
      const data = await res.json()
      if (!res.ok) { const err = new Error(data.error || ('HTTP ' + res.status)); err.code = data.code; throw err }
      this.setState((s) => ({ chatMsgs: [...s.chatMsgs, { role: 'ai', text: data.text || '', bullets: data.bullets || [], sources: data.sources || [] }], chatTyping: false }))
    } catch (err) {
      if (err.code === 'no_key' || /key/i.test(err.message)) {
        // No API key yet — fall back to a canned reply so the demo still works.
        const fallback = this.replyFor(text)
        fallback.text = '⚙️ Offline demo reply — add GROQ_API_KEY to .env (see .env.example) and restart the dev server for real Mentor AI. ' + fallback.text
        this.setState((s) => ({ chatMsgs: [...s.chatMsgs, { role: 'ai', ...fallback }], chatTyping: false }))
      } else {
        this.setState((s) => ({ chatMsgs: [...s.chatMsgs, { role: 'ai', text: 'Sorry — I hit an error reaching the model: ' + err.message, bullets: [], sources: [] }], chatTyping: false }))
      }
    }
  }
  // Learner context Mentor AI grounds its answers in.
  // Uses real generated roadmap when available; falls back to mock data.
  mentorContext() {
    const rm = this.state.roadmap
    if (rm && Array.isArray(rm.phases)) {
      return {
        learner: 'Learner',
        goal: `${rm.headline} — ${rm.totalWeeks}-week roadmap, ${rm.hoursPerDay}/day, target ${rm.targetDate}`,
        phases: rm.phases.map((p) => ({ n: p.n, name: `${p.title} (${p.cert})`, status: p.status + ' (' + p.pct + '%)' })),
        streakDays: this.state.progress.streak,
        hoursStudied: this.state.progress.hoursStudied,
        learningScore: Math.round(this.state.progress.hoursStudied * 100 + (this.state.tasks || []).filter((t) => t.done).length * 50),
        watchAreas: rm.watchAreas || [],
      }
    }
    return {
      learner: this.state.userName || 'Learner',
      goal: 'No roadmap generated yet. Encourage the learner to complete onboarding.',
      phases: [],
      streakDays: 0,
      hoursStudied: 0,
      learningScore: 0,
      watchAreas: [],
    }
  }
  newChat() { this.setState({ chatMsgs: [], chatInput: '' }) }
  replyFor(t) {
    const rm = this.state.roadmap
    const topic = rm?.headline || 'your learning goal'
    const phase = rm?.phases?.find((p) => p.status === 'In progress') || rm?.phases?.[0]
    return {
      text: 'Good question! To give you the best answer I need a live connection to Mentor AI — add GROQ_API_KEY to .env and restart. Here\'s a general take on ' + topic + ':',
      bullets: [
        phase ? ('Focus on ' + phase.title + ' — ' + phase.sub) : 'Start with the fundamentals and build a solid foundation.',
        'Consistency beats intensity — even 30 minutes daily compounds fast.',
        'Hands-on projects lock in what you learn far better than passive reading.',
      ],
      sources: [rm ? { t: 'Your roadmap · ' + topic, m: 'Mentor AI' } : { t: 'Learning best practices', m: 'Mentor AI' }],
    }
  }

  toggleTheme() { this.setState((s) => ({ theme: s.theme === 'light' ? 'dark' : 'light' })) }
  toggleFaq(i) { return () => this.setState((s) => ({ faqOpen: s.faqOpen === i ? -1 : i })) }

  parseMins(str) {
    if (!str) return 0
    const s = String(str).toLowerCase()
    const h = parseFloat(s.match(/(\d+\.?\d*)\s*h/)?.[1] || 0)
    const m = parseFloat(s.match(/(\d+)\s*min/)?.[1] || 0)
    return h * 60 + m
  }

  toggleTask(i) {
    return () => this.setState((s) => {
      const rm = s.roadmap
      const base = s.tasks || (rm && rm.todaysTasks && rm.todaysTasks.length ? rm.todaysTasks : LearnFlow.MOCK_TASKS)
      const tasks = base.map((t, idx) => idx === i ? { ...t, done: !t.done } : t)
      const wasDone = base[i]?.done
      const nowDone = !wasDone
      const mins = this.parseMins(base[i]?.d || '')
      const delta = (nowDone ? 1 : -1) * mins / 60
      const hoursStudied = parseFloat(Math.max(0, (s.progress.hoursStudied || 0) + delta).toFixed(2))
      const today = new Date().toISOString().slice(0, 10)
      let { streak = 0, lastDate, dates = [] } = s.progress
      if (nowDone && lastDate !== today) {
        const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
        streak = lastDate === yesterday ? streak + 1 : 1
        lastDate = today
        if (!dates.includes(today)) dates = [...dates, today]
      }
      return { tasks, progress: { streak, hoursStudied, lastDate, dates } }
    })
  }

  getInitials(name) {
    if (!name) return 'AC'
    const parts = name.trim().split(/\s+/)
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    return parts[0].slice(0, 2).toUpperCase()
  }

  setSetting(key, val) { this.setState((s) => ({ settings: { ...s.settings, [key]: val } })) }

  resetRoadmap() {
    this.setState({
      roadmap: null, tasks: null, progress: { streak: 0, hoursStudied: 0, lastDate: null },
      obStep: 1, obData: { topic: '', level: '', goal: '', time: '' }, obPhase: 'question', obGenIdx: 0, screen: 'onboarding',
    })
  }

  // ---------- SUPABASE AUTH ----------
  async loadFromSupabase(userId) {
    try {
      const { data } = await supabase.from('user_data').select('*').eq('id', userId).single()
      if (data) {
        const patch = { screen: 'dashboard' }
        if (data.roadmap) patch.roadmap = data.roadmap
        if (data.tasks) patch.tasks = data.tasks
        if (data.progress) patch.progress = data.progress
        if (data.user_name) patch.userName = data.user_name
        if (data.ob_data && data.ob_data.topic) { patch.obData = data.ob_data; patch.obPhase = 'done' }
        if (data.chat_msgs && data.chat_msgs.length) patch.chatMsgs = data.chat_msgs
        if (data.settings) patch.settings = { ...this.state.settings, ...data.settings }
        this.setState(patch)
      } else {
        this.setState({ screen: 'onboarding' })
      }
    } catch {
      this.setState({ screen: 'onboarding' })
    }
  }

  async _saveToSupabase() {
    if (!supabase || !this.state.user) return
    const { roadmap, tasks, progress, userName, obData, chatMsgs, settings } = this.state
    try {
      await supabase.from('user_data').upsert({
        id: this.state.user.id,
        roadmap, tasks, progress, settings,
        user_name: userName,
        ob_data: obData,
        chat_msgs: chatMsgs,
        updated_at: new Date().toISOString(),
      })
    } catch { /* non-fatal — local save already happened */ }
  }

  async doAuth() {
    const { authMode, authEmail, authPassword, authName } = this.state
    if (!authEmail || !authPassword) {
      this.setState({ authError: 'Please enter your email and password.' })
      return
    }
    this.setState({ authLoading: true, authError: '' })
    try {
      if (authMode === 'signup') {
        const { data, error } = await supabase.auth.signUp({ email: authEmail, password: authPassword })
        if (error) throw error
        const resolvedName = authName.trim() || authEmail.split('@')[0]
        if (data.session) {
          this.setState({ user: data.user, userName: resolvedName, authLoading: false, authName: '', authEmail: '', authPassword: '', screen: 'onboarding' })
        } else {
          this.setState({ authLoading: false, authError: '✉️ Check your inbox to confirm your account, then sign in.' })
        }
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email: authEmail, password: authPassword })
        if (error) throw error
        this.setState({ user: data.user, authEmail: '', authPassword: '' })
        await this.loadFromSupabase(data.user.id)
        this.setState({ authLoading: false })
      }
    } catch (err) {
      this.setState({ authLoading: false, authError: err.message || 'Something went wrong.' })
    }
  }

  async doSignOut() {
    if (supabase) await supabase.auth.signOut().catch(() => {})
    localStorage.removeItem('lf_state')
    this.setState({
      user: null, roadmap: null, tasks: null,
      progress: { streak: 0, hoursStudied: 0, lastDate: null },
      userName: '', chatMsgs: [],
      obData: { topic: '', level: '', goal: '', time: '' },
      obPhase: 'question', obStep: 1, obGenIdx: 0, screen: 'landing',
    })
  }

  // ---------- helpers ----------
  ring(pct, r) { const c = 2 * Math.PI * r; return { c, off: c * (1 - pct / 100) } }

  renderVals() {
    const t = this.state.theme
    const dark = t === 'dark'
    const screen = this.state.screen
    const goTo = {}
    ;['landing', 'onboarding', 'auth', 'dashboard', 'roadmap', 'planner', 'analytics', 'skilltree', 'mentor', 'library', 'goals', 'settings', 'mobile'].forEach((s) => { goTo[s] = this.go(s) })

    const navDefs = [
      ['dashboard', 'Dashboard', 'M4 4h7v7H4z M13 4h7v4h-7z M13 11h7v9h-7z M4 14h7v6H4z', ''],
      ['roadmap', 'Roadmap', 'M9 4 4 6v14l5-2 6 2 5-2V4l-5 2-6-2z M9 4v14 M15 6v14', '3'],
      ['planner', 'Planner', 'M4 7h16v13H4z M4 11h16 M8 4v4 M16 4v4', ''],
      ['analytics', 'Analytics', 'M4 20V11 M10 20V4 M16 20v-6 M3 20h18', ''],
      ['skilltree', 'Skill Tree', 'M12 3v4 M6 17l6-6 6 6 M10 3h4v4h-4z M4 17h4v4H4z M16 17h4v4h-4z', ''],
      ['library', 'Library', 'M6 4h10v16H8a2 2 0 0 0-2 2z M6 4v18', ''],
      ['goals', 'Goals', 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M12 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2z', ''],
      ['mobile', 'Mobile App', 'M7 3h10v18H7z M10 18h4', ''],
    ]
    const nav = navDefs.map(([key, label, icon, badge]) => ({
      key, label, icon, onClick: this.go(key),
      active: screen === key,
      bg: screen === key ? 'var(--blue-soft)' : 'transparent',
      color: screen === key ? 'var(--blue-ink)' : 'var(--muted)',
      weight: screen === key ? 700 : 500,
      badge: !!badge, badgeText: badge,
    }))

    const titles = { dashboard: 'Dashboard', roadmap: 'Learning Roadmap', planner: 'Planner', analytics: 'Progress Analytics', skilltree: 'Skill Tree', library: 'Resource Library', goals: 'Goals & Milestones', settings: 'Settings', mobile: 'Mobile App' }

    return {
      theme: t, dark,
      themeIcon: dark
        ? e('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round' }, e('circle', { cx: 12, cy: 12, r: 4 }), e('path', { d: 'M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4' }))
        : e('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round' }, e('path', { d: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z' })),
      isLanding: screen === 'landing',
      isOnboarding: screen === 'onboarding',
      isAuth: screen === 'auth',
      isMentor: screen === 'mentor',
      isApp: !['landing', 'onboarding', 'auth', 'mentor'].includes(screen),
      goStart: supabase ? this.go('auth') : this.go('onboarding'),
      isDashboard: screen === 'dashboard', isRoadmap: screen === 'roadmap', isPlanner: screen === 'planner',
      isAnalytics: screen === 'analytics', isSkilltree: screen === 'skilltree', isLibrary: screen === 'library',
      isGoals: screen === 'goals', isSettings: screen === 'settings', isMobile: screen === 'mobile',
      goTo, toggleTheme: () => this.toggleTheme(),
      nav, screenTitle: titles[screen] || '',

      previewPhases: this.state.roadmap && Array.isArray(this.state.roadmap.phases)
        ? this.state.roadmap.phases.map((p, i) => {
            const clrs = [{ bg: 'var(--emerald-soft)', fg: 'var(--emerald)' }, { bg: 'var(--blue-soft)', fg: 'var(--blue-ink)' }, { bg: 'var(--violet-soft)', fg: 'var(--violet)' }, { bg: 'var(--amber-soft)', fg: 'var(--amber)' }]
            const c = clrs[i % clrs.length]
            return { n: p.n, title: p.title + ' · ' + p.cert, pct: p.pct + '%', bg: c.bg, fg: c.fg }
          })
        : [
            { n: 1, title: 'Foundation · AZ-900', pct: '100%', bg: 'var(--emerald-soft)', fg: 'var(--emerald)' },
            { n: 2, title: 'Administration · AZ-104', pct: '72%', bg: 'var(--blue-soft)', fg: 'var(--blue-ink)' },
            { n: 3, title: 'Architecture · AZ-305', pct: '28%', bg: 'var(--violet-soft)', fg: 'var(--violet)' },
            { n: 4, title: 'Mastery · DevOps & IaC', pct: '4%', bg: 'var(--surface-3)', fg: 'var(--subtle)' },
          ],
      features: [
        { title: 'AI Learning Planner', desc: 'Describe a goal in plain language. Mentor AI builds a phased roadmap with weekly plans and daily tasks.', icon: 'M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1', color: 'var(--blue)', soft: 'var(--blue-soft)' },
        { title: 'Progress Coach', desc: 'Streaks, completion rates, and consistency tracked automatically — with nudges before you fall behind.', icon: 'M4 20V11M10 20V4M16 20v-6M3 20h18', color: 'var(--emerald)', soft: 'var(--emerald-soft)' },
        { title: 'Career Advisor', desc: 'Maps your current skills to target roles and industry demand, then recommends the gaps to close.', icon: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z', color: 'var(--violet)', soft: 'var(--violet-soft)' },
        { title: 'Weekly Review', desc: 'An executive summary every Sunday: accomplishments, missed goals, and what to prioritize next.', icon: 'M7 3h10v18H7zM7 7h10M7 11h10M7 15h6', color: 'var(--amber)', soft: 'var(--amber-soft)' },
        { title: 'Skill Tree', desc: "See your knowledge as a living map — what you've mastered, what's in progress, and what unlocks next.", icon: 'M12 3v4M6 17l6-6 6 6M10 3h4v4h-4zM4 17h4v4H4zM16 17h4v4h-4z', color: 'var(--blue)', soft: 'var(--blue-soft)' },
        { title: 'Grounded Answers', desc: 'Every Mentor AI reply cites your roadmap and verified sources — guidance you can actually trust.', icon: 'M6 4h10v16H8a2 2 0 0 0-2 2zM6 4v18', color: 'var(--emerald)', soft: 'var(--emerald-soft)' },
      ],
      testimonials: [
        { quote: 'I went from zero cloud experience to AZ-104 certified in 5 months. The weekly reviews kept me honest.', name: 'Priya Nair', role: 'Cloud Engineer, Stripe', initials: 'PN', bg: 'var(--blue-soft)', fg: 'var(--blue-ink)' },
        { quote: 'It feels like having a staff-level mentor on call. The roadmap adapted every time my schedule slipped.', name: 'Marcus Lee', role: 'SRE, Spotify', initials: 'ML', bg: 'var(--emerald-soft)', fg: 'var(--emerald)' },
        { quote: 'The skill tree finally made my growth visible. My manager and I use it in every 1:1.', name: 'Sofia Alvarez', role: 'PM, Atlassian', initials: 'SA', bg: 'var(--violet-soft)', fg: 'var(--violet)' },
      ],
      pricing: [
        { name: 'Free — always', price: '$0', per: '', tagline: 'Everything included, no card required', feats: ['Unlimited AI-generated roadmaps', 'Full Mentor AI chat', 'Progress tracking & streaks', 'Analytics & skill tree', 'Weekly planner & task board', 'Cross-device sync'], cta: 'Start learning free', featured: true,
          cardBg: 'linear-gradient(160deg,var(--blue),var(--violet))', border: 'transparent', shadow: 'var(--shadow-lg)', text: '#fff', check: '#fff', btnBg: '#fff', btnText: 'var(--blue-ink)' },
      ],
      faqs: [
        { q: 'How does Mentor AI build my roadmap?', a: 'You describe your goal, level, and time commitment. Mentor AI maps that to certification objectives and proven learning paths, then generates phases, weekly plans, and daily tasks — adapting as you progress.' },
        { q: 'Can I use it for any skill, not just cloud?', a: 'Yes. From data science to product management to design, Mentor AI builds structured paths for any skill. Cloud/Azure is just our most popular track.' },
        { q: 'Does it work on mobile?', a: 'Fully. The mobile app has your dashboard, planner, AI mentor, and roadmap — designed for one-handed use so you can learn anywhere.' },
        { q: 'Is my data private?', a: 'Your learning data is encrypted and never sold. Mentor AI uses it only to personalize your experience. You can export or delete everything at any time.' },
      ].map((f, i) => ({ ...f, open: this.state.faqOpen === i, sign: this.state.faqOpen === i ? '−' : '+', onToggle: this.toggleFaq(i) })),

      obStep: this.state.obStep,
      obData: this.state.obData,
      obProgress: ((this.state.obPhase === 'done' ? 5 : this.state.obStep) / 5 * 100) + '%',
      obStepQuestion: this.state.obPhase === 'question',
      obGenerating: this.state.obPhase === 'generating',
      obDone: this.state.obPhase === 'done',
      obCanBack: this.state.obStep > 1,
      obBack: () => this.obBack(),
      obQ: this.buildObQuestion(),
      obGenSteps: ['Mapping skills to certification objectives', 'Sequencing learning phases', 'Generating weekly plan & daily tasks', 'Calibrating to your schedule', 'Finalizing milestones'].map((label, i) => ({ label, done: i < this.state.obGenIdx, opacity: i <= this.state.obGenIdx ? 1 : 0.4, dot: i < this.state.obGenIdx ? 'var(--emerald)' : (i === this.state.obGenIdx ? 'var(--blue)' : 'var(--surface-3)') })),

      chatInput: this.state.chatInput,
      onChatInput: (ev) => this.onChatInput(ev),
      onChatKey: (ev) => this.onChatKey(ev),
      sendChat: () => this.doSend(),
      newChat: () => this.newChat(),
      chatHistory: this.state.chatMsgs.length > 0 ? ['Recent conversation'] : [],
      chatSuggestions: (() => {
        const rm = this.state.roadmap
        if (rm) {
          const curPhase = rm.phases && rm.phases.find((p) => p.status === 'In progress') || rm.phases?.[0]
          const skill = curPhase?.skills?.[0] || 'my current topic'
          return [
            { text: 'What should I focus on today?', onClick: this.send('What should I focus on today based on my ' + rm.headline + ' roadmap?') },
            { text: 'Quiz me on ' + skill, onClick: this.send('Quiz me on ' + skill) },
            { text: 'Am I on track?', onClick: this.send('Am I on track with my ' + rm.headline + ' goal? Target: ' + rm.targetDate) },
          ]
        }
        return [
          { text: 'How do I get started?', onClick: this.send('How do I get started with my learning goal?') },
          { text: 'Help me build a study plan', onClick: this.send('Help me build a structured study plan for my goal') },
          { text: 'What skills should I prioritize?', onClick: this.send('What skills should I prioritize first?') },
        ]
      })(),
    }
  }

  buildObQuestion() {
    const s = this.state; const step = s.obStep
    const opt = (label, key, val, next, extra = {}) => ({
      label, onClick: this.obSelect(key, val, next),
      border: s.obData[key] === val ? 'var(--blue)' : 'var(--border)',
      bg: s.obData[key] === val ? 'var(--blue-soft)' : 'var(--surface)',
      text: 'var(--text)', shadow: s.obData[key] === val ? 'var(--shadow-sm)' : 'none',
      emoji: !!extra.icon, icon: extra.icon || '', hasDesc: !!extra.desc, desc: extra.desc || '',
    })
    if (step === 1) return { title: 'What do you want to learn?', sub: 'Pick a track or type your own goal.', cols: '1fr 1fr', maxw: '560px', pad: '18px', showCustomInput: true, options: [
      opt('Azure', 'topic', 'Azure Cloud Architect', 2, { icon: '☁️' }),
      opt('AWS', 'topic', 'AWS Solutions Architect', 2, { icon: '🟧' }),
      opt('Power BI', 'topic', 'Power BI Analyst', 2, { icon: '📊' }),
      opt('Data Science', 'topic', 'Data Science', 2, { icon: '🧪' }),
      opt('Python', 'topic', 'Python Developer', 2, { icon: '🐍' }),
      opt('AI Engineering', 'topic', 'AI Engineering', 2, { icon: '🤖' }),
    ] }
    if (step === 2) return { title: "What's your current level?", sub: 'Mentor AI calibrates the starting point and pace.', cols: '1fr', maxw: '440px', pad: '18px', options: [
      opt('Beginner', 'level', 'Beginner', 3, { desc: 'New to this — start from fundamentals' }),
      opt('Intermediate', 'level', 'Intermediate', 3, { desc: 'Some experience, ready to go deeper' }),
      opt('Advanced', 'level', 'Advanced', 3, { desc: 'Confident — focused on mastery & certs' }),
    ] }
    if (step === 3) return { title: "What's your target goal?", sub: 'This shapes your milestones and projects.', cols: '1fr 1fr', maxw: '520px', pad: '18px', options: [
      opt('Get certified', 'goal', 'Get certified', 4, { icon: '🎓' }),
      opt('Land a job', 'goal', 'Land a job', 4, { icon: '💼' }),
      opt('Build a product', 'goal', 'Build a product', 4, { icon: '🚀' }),
      opt('Start a business', 'goal', 'Start a business', 4, { icon: '🏢' }),
    ] }
    return { title: 'How much time can you commit?', sub: "Be honest — Mentor AI builds a plan you'll actually keep.", cols: '1fr 1fr', maxw: '520px', pad: '18px', options: [
      opt('30 min / day', 'time', '30 min/day', 'generate', { desc: '~12 month track' }),
      opt('1 hour / day', 'time', '1 hour/day', 'generate', { desc: '~8 month track' }),
      opt('2 hours / day', 'time', '2 hours/day', 'generate', { desc: '~5 month track' }),
      opt('Custom', 'time', 'a custom schedule', 'generate', { desc: 'Set per-day availability' }),
    ] }
  }

  fmt(text) {
    const parts = String(text).split(/(\*\*[^*]+\*\*)/g)
    return parts.map((p, i) => (p.startsWith('**') && p.endsWith('**')) ? e('b', { key: i }, p.slice(2, -2)) : p)
  }

  // ============ PAGE SHELLS ============
  render() {
    if (this.state.sessionLoading) {
      return (
        <div data-theme={this.state.theme} style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
            <div style={{ width: 44, height: 44, borderRadius: 13, background: 'linear-gradient(135deg,var(--blue),var(--violet))', display: 'flex', alignItems: 'center', justifyContent: 'center', animation: 'lf-blink 1.2s infinite' }}>
              <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><path d="M4 7l8-4 8 4-8 4-8-4z" /><path d="M4 7v6l8 4 8-4V7" /></svg>
            </div>
            <span style={{ fontSize: 14, color: 'var(--muted)', fontWeight: 500 }}>Loading…</span>
          </div>
        </div>
      )
    }
    const v = this.renderVals()
    return (
      <div className="lf" data-theme={v.theme} style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)', position: 'relative' }}>
        {v.isLanding && this.renderLanding(v)}
        {v.isOnboarding && this.renderOnboarding(v)}
        {v.isAuth && this.renderAuth(v)}
        {v.isApp && this.renderApp(v)}
        {v.isMentor && this.renderMentor(v)}
      </div>
    )
  }

  renderLanding(v) {
    return (
      <div className="lf-screen lf-scroll" style={S('min-height:100vh; overflow-y:auto')}>
        <div style={S('position:sticky; top:0; z-index:30; backdrop-filter:blur(16px); background:var(--glass); border-bottom:1px solid var(--border)')}>
          <div style={S('max-width:1180px; margin:0 auto; padding:16px 28px; display:flex; align-items:center; justify-content:space-between')}>
            <div style={S('display:flex; align-items:center; gap:11px')}>
              <div style={S('width:34px; height:34px; border-radius:10px; background:linear-gradient(135deg,var(--blue),var(--violet)); display:flex; align-items:center; justify-content:center; box-shadow:var(--shadow-sm)')}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7l8-4 8 4-8 4-8-4z" /><path d="M4 7v6l8 4 8-4V7" /></svg>
              </div>
              <span style={S('font-weight:800; font-size:18px; letter-spacing:-.02em')}>LearnFlow<span style={S('color:var(--blue)')}> AI</span></span>
            </div>
            <div style={S('display:flex; align-items:center; gap:26px')}>
              <span style={S('font-size:14px; color:var(--muted); font-weight:500; cursor:pointer')}>Features</span>
              <span style={S('font-size:14px; color:var(--muted); font-weight:500; cursor:pointer')}>Pricing</span>
              <span style={S('font-size:14px; color:var(--muted); font-weight:500; cursor:pointer')}>FAQ</span>
              <button className="lf-btn" onClick={v.toggleTheme} style={S('width:38px; height:38px; border-radius:11px; border:1px solid var(--border); background:var(--surface); color:var(--text); cursor:pointer; display:flex; align-items:center; justify-content:center')}>{v.themeIcon}</button>
              <button className="lf-btn" onClick={v.goStart} style={S('padding:10px 18px; border-radius:11px; border:none; background:var(--text); color:var(--bg); font-weight:600; font-size:14px; cursor:pointer')}>Start free</button>
            </div>
          </div>
        </div>

        {/* hero */}
        <div style={S('max-width:1180px; margin:0 auto; padding:84px 28px 60px; text-align:center; position:relative')}>
          <div style={S('display:inline-flex; align-items:center; gap:9px; padding:7px 15px; border-radius:99px; background:var(--blue-soft); border:1px solid var(--border); margin-bottom:30px')}>
            <span style={S('width:7px; height:7px; border-radius:99px; background:var(--emerald)')} />
            <span style={S('font-size:13px; font-weight:600; color:var(--blue-ink)')}>Meet Mentor AI — your personal learning architect</span>
          </div>
          <h1 style={S('font-size:68px; line-height:1.04; font-weight:800; letter-spacing:-.035em; margin:0 auto 22px; max-width:880px; text-wrap:balance')}>Turn learning goals into <span style={S('background:linear-gradient(120deg,var(--blue),var(--violet)); -webkit-background-clip:text; background-clip:text; color:transparent')}>achievements</span></h1>
          <p style={S('font-size:20px; line-height:1.5; color:var(--muted); max-width:600px; margin:0 auto 38px; text-wrap:pretty')}>AI-powered learning plans, progress tracking, and personalized guidance to help you master any skill — from your first course to your dream certification.</p>
          <div style={S('display:flex; gap:14px; justify-content:center; align-items:center; flex-wrap:wrap')}>
            <button className="lf-btn" onClick={v.goStart} style={S('padding:15px 26px; border-radius:13px; border:none; background:linear-gradient(135deg,var(--blue),var(--blue-ink)); color:#fff; font-weight:600; font-size:16px; cursor:pointer; box-shadow:var(--shadow)')}>Start Learning Free</button>
            <button className="lf-btn" onClick={v.goTo.dashboard} style={S('padding:15px 24px; border-radius:13px; border:1px solid var(--border-strong); background:var(--surface); color:var(--text); font-weight:600; font-size:16px; cursor:pointer; display:flex; align-items:center; gap:9px')}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>Watch demo
            </button>
          </div>
          <div style={S('margin-top:18px; font-size:13px; color:var(--subtle)')}>No credit card · No trial · Free forever</div>

          {/* product preview */}
          <div style={S('margin-top:64px; border-radius:24px; border:1px solid var(--border); background:var(--surface); box-shadow:var(--shadow-lg); overflow:hidden; text-align:left')}>
            <div style={S('height:42px; display:flex; align-items:center; gap:8px; padding:0 18px; border-bottom:1px solid var(--border); background:var(--surface-2)')}>
              <span style={S('width:11px;height:11px;border-radius:99px;background:#FF5F57')} />
              <span style={S('width:11px;height:11px;border-radius:99px;background:#FEBC2E')} />
              <span style={S('width:11px;height:11px;border-radius:99px;background:#28C840')} />
              <span style={S("margin-left:14px; font-size:12px; color:var(--subtle); font-family:'JetBrains Mono',monospace")}>app.learnflow.ai/roadmap</span>
            </div>
            <div style={S('padding:26px; display:grid; grid-template-columns:1.3fr 1fr; gap:20px; background:var(--bg)')}>
              <div style={S('border-radius:18px; background:var(--surface); border:1px solid var(--border); padding:22px; box-shadow:var(--shadow-sm)')}>
                <div style={S('font-size:12px; font-weight:700; color:var(--blue); letter-spacing:.08em; text-transform:uppercase; margin-bottom:6px')}>Your roadmap</div>
                <div style={S('font-size:20px; font-weight:700; margin-bottom:18px')}>Azure Cloud Architect · 12 months</div>
                {v.previewPhases.map((p, i) => (
                  <div key={i} style={S('display:flex; align-items:center; gap:14px; margin-bottom:13px')}>
                    <div style={S(`width:30px; height:30px; border-radius:9px; background:${p.bg}; color:${p.fg}; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:13px; flex:none`)}>{p.n}</div>
                    <div style={S('flex:1')}>
                      <div style={S('font-size:14px; font-weight:600')}>{p.title}</div>
                      <div style={S('height:6px; border-radius:99px; background:var(--surface-3); margin-top:7px; overflow:hidden')}><div style={S(`height:100%; width:${p.pct}; border-radius:99px; background:linear-gradient(90deg,var(--blue),var(--violet))`)} /></div>
                    </div>
                  </div>
                ))}
              </div>
              <div style={S('display:flex; flex-direction:column; gap:16px')}>
                <div style={S('border-radius:18px; background:linear-gradient(150deg,var(--blue),var(--violet)); color:#fff; padding:20px; box-shadow:var(--shadow)')}>
                  <div style={S('font-size:12px; opacity:.85; font-weight:600')}>Learning Score</div>
                  <div style={S('font-size:46px; font-weight:800; letter-spacing:-.03em; line-height:1.1')}>782</div>
                  <div style={S('font-size:13px; opacity:.9')}>▲ 34 this week · top 8%</div>
                </div>
                <div style={S('border-radius:18px; background:var(--surface); border:1px solid var(--border); padding:18px; box-shadow:var(--shadow-sm)')}>
                  <div style={S('font-size:12px; color:var(--muted); font-weight:600; margin-bottom:10px')}>Mentor AI suggests</div>
                  <div style={S('font-size:13.5px; line-height:1.5; color:var(--text)')}>You're ahead on networking. Start <b>AZ-305 case studies</b> this week to stay on track for March certification.</div>
                </div>
              </div>
            </div>
          </div>

          <div style={S('margin-top:46px; display:flex; gap:38px; justify-content:center; align-items:center; opacity:.6; flex-wrap:wrap; font-weight:700; font-size:15px; letter-spacing:-.01em')}>
            <span>Trusted by learners at</span>
            <span>Microsoft</span><span>Spotify</span><span>Stripe</span><span>Atlassian</span><span>Figma</span>
          </div>
        </div>

        {/* features */}
        <div style={S('max-width:1180px; margin:0 auto; padding:60px 28px')}>
          <div style={S('text-align:center; margin-bottom:48px')}>
            <div style={S('font-size:13px; font-weight:700; color:var(--blue); letter-spacing:.1em; text-transform:uppercase; margin-bottom:12px')}>An AI that mentors, not just tracks</div>
            <h2 style={S('font-size:42px; font-weight:800; letter-spacing:-.03em; margin:0; text-wrap:balance')}>Everything you need to master a skill</h2>
          </div>
          <div style={S('display:grid; grid-template-columns:repeat(3,1fr); gap:20px')}>
            {v.features.map((f, i) => (
              <div key={i} className="lf-card-h" style={S('border-radius:20px; background:var(--surface); border:1px solid var(--border); padding:26px; box-shadow:var(--shadow-sm); cursor:default')}>
                <div style={S(`width:46px; height:46px; border-radius:13px; background:${f.soft}; color:${f.color}; display:flex; align-items:center; justify-content:center; margin-bottom:18px`)}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={f.icon} /></svg>
                </div>
                <div style={S('font-size:17px; font-weight:700; margin-bottom:8px')}>{f.title}</div>
                <div style={S('font-size:14.5px; line-height:1.55; color:var(--muted)')}>{f.desc}</div>
              </div>
            ))}
          </div>
        </div>

        {/* testimonials */}
        <div style={S('max-width:1180px; margin:0 auto; padding:50px 28px')}>
          <div style={S('display:grid; grid-template-columns:repeat(3,1fr); gap:20px')}>
            {v.testimonials.map((t, i) => (
              <div key={i} style={S('border-radius:20px; background:var(--surface); border:1px solid var(--border); padding:26px; box-shadow:var(--shadow-sm)')}>
                <div style={S('font-size:15.5px; line-height:1.6; margin-bottom:20px; color:var(--text)')}>“{t.quote}”</div>
                <div style={S('display:flex; align-items:center; gap:12px')}>
                  <div style={S(`width:40px; height:40px; border-radius:99px; background:${t.bg}; color:${t.fg}; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:14px`)}>{t.initials}</div>
                  <div><div style={S('font-size:14px; font-weight:600')}>{t.name}</div><div style={S('font-size:13px; color:var(--subtle)')}>{t.role}</div></div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* pricing */}
        <div style={S('max-width:1100px; margin:0 auto; padding:60px 28px')}>
          <div style={S('text-align:center; margin-bottom:44px')}>
            <h2 style={S('font-size:42px; font-weight:800; letter-spacing:-.03em; margin:0 0 10px')}>100% free, forever</h2>
            <p style={S('font-size:17px; color:var(--muted); margin:0')}>No credit card. No trial. No catch. Everything is included from day one.</p>
          </div>
          <div style={S('display:grid; grid-template-columns:1fr; gap:20px; align-items:stretch; max-width:520px; margin:0 auto')}>
            {v.pricing.map((p, i) => (
              <div key={i} className="lf-card-h" style={S(`border-radius:22px; background:${p.cardBg}; border:1.5px solid ${p.border}; padding:30px; box-shadow:${p.shadow}; color:${p.text}; position:relative; display:flex; flex-direction:column`)}>
                {p.featured && <div style={S('position:absolute; top:-12px; left:50%; transform:translateX(-50%); padding:5px 13px; border-radius:99px; background:var(--amber); color:#3a2a00; font-size:11px; font-weight:800; letter-spacing:.04em')}>MOST POPULAR</div>}
                <div style={S('font-size:15px; font-weight:700; opacity:.8')}>{p.name}</div>
                <div style={S('display:flex; align-items:baseline; gap:6px; margin:14px 0 6px')}><span style={S('font-size:46px; font-weight:800; letter-spacing:-.03em')}>{p.price}</span><span style={S('font-size:15px; opacity:.7')}>{p.per}</span></div>
                <div style={S('font-size:14px; opacity:.7; margin-bottom:22px')}>{p.tagline}</div>
                <div style={S('display:flex; flex-direction:column; gap:11px; margin-bottom:26px; flex:1')}>
                  {p.feats.map((ft, j) => (
                    <div key={j} style={S('display:flex; align-items:center; gap:10px; font-size:14px')}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={p.check} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg><span style={S('opacity:.92')}>{ft}</span></div>
                  ))}
                </div>
                <button className="lf-btn" onClick={v.goStart} style={S(`padding:13px; border-radius:12px; border:none; background:${p.btnBg}; color:${p.btnText}; font-weight:600; font-size:15px; cursor:pointer; width:100%`)}>{p.cta}</button>
              </div>
            ))}
          </div>
        </div>

        {/* faq */}
        <div style={S('max-width:760px; margin:0 auto; padding:50px 28px 30px')}>
          <h2 style={S('font-size:32px; font-weight:800; letter-spacing:-.03em; margin:0 0 28px; text-align:center')}>Frequently asked</h2>
          {v.faqs.map((q, i) => (
            <div key={i} style={S('border-bottom:1px solid var(--border); padding:18px 4px; cursor:pointer')} onClick={q.onToggle}>
              <div style={S('display:flex; justify-content:space-between; align-items:center; gap:16px')}>
                <span style={S('font-size:16px; font-weight:600')}>{q.q}</span>
                <span style={S('font-size:22px; color:var(--subtle); font-weight:400; flex:none')}>{q.sign}</span>
              </div>
              {q.open && <div style={S('font-size:14.5px; line-height:1.6; color:var(--muted); margin-top:12px; max-width:640px')}>{q.a}</div>}
            </div>
          ))}
        </div>

        {/* cta + footer */}
        <div style={S('max-width:1180px; margin:40px auto 0; padding:0 28px')}>
          <div style={S('border-radius:26px; background:linear-gradient(135deg,var(--blue),var(--violet)); padding:56px 40px; text-align:center; color:#fff; box-shadow:var(--shadow-lg)')}>
            <h2 style={S('font-size:40px; font-weight:800; letter-spacing:-.03em; margin:0 0 14px; text-wrap:balance')}>Your next certification starts today</h2>
            <p style={S('font-size:18px; opacity:.92; margin:0 0 28px')}>Tell Mentor AI your goal. Get a roadmap in 30 seconds.</p>
            <button className="lf-btn" onClick={v.goStart} style={S('padding:15px 30px; border-radius:13px; border:none; background:#fff; color:var(--blue-ink); font-weight:700; font-size:16px; cursor:pointer')}>Build my roadmap</button>
          </div>
        </div>
        <div style={S('max-width:1180px; margin:0 auto; padding:46px 28px 60px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:16px; color:var(--subtle); font-size:13px')}>
          <span>© 2026 LearnFlow AI · Your Personal AI Learning Architect</span>
          <span style={S('display:flex; gap:20px')}><span>Privacy</span><span>Terms</span><span>Security</span><span>Careers</span></span>
        </div>
      </div>
    )
  }

  renderOnboarding(v) {
    return (
      <div className="lf-screen" style={S('min-height:100vh; display:flex; flex-direction:column')}>
        <div style={S('padding:22px 28px; display:flex; align-items:center; justify-content:space-between')}>
          <div style={S('display:flex; align-items:center; gap:11px')}>
            <div style={S('width:32px; height:32px; border-radius:9px; background:linear-gradient(135deg,var(--blue),var(--violet)); display:flex; align-items:center; justify-content:center')}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7l8-4 8 4-8 4-8-4z" /><path d="M4 7v6l8 4 8-4V7" /></svg></div>
            <span style={S('font-weight:800; font-size:16px')}>LearnFlow<span style={S('color:var(--blue)')}> AI</span></span>
          </div>
          <button className="lf-btn" onClick={v.goTo.landing} style={S('padding:8px 14px; border-radius:10px; border:1px solid var(--border); background:var(--surface); color:var(--muted); font-size:13px; font-weight:600; cursor:pointer')}>Skip</button>
        </div>
        <div style={S('height:4px; background:var(--surface-2)')}><div style={S(`height:100%; width:${v.obProgress}; background:linear-gradient(90deg,var(--blue),var(--violet)); border-radius:0 99px 99px 0; transition:width .5s cubic-bezier(.22,1,.36,1)`)} /></div>

        <div style={S('flex:1; display:flex; align-items:center; justify-content:center; padding:30px')}>
          <div style={S('width:100%; max-width:720px')}>
            {v.obStepQuestion && (
              <div className="lf-screen" style={S('text-align:center')}>
                <div style={S('font-size:13px; font-weight:700; color:var(--blue); letter-spacing:.1em; margin-bottom:14px')}>STEP {v.obStep} OF 5</div>
                <h1 style={S('font-size:40px; font-weight:800; letter-spacing:-.03em; margin:0 0 12px; text-wrap:balance')}>{v.obQ.title}</h1>
                <p style={S('font-size:17px; color:var(--muted); margin:0 0 38px')}>{v.obQ.sub}</p>
                <div style={S(`display:grid; grid-template-columns:${v.obQ.cols}; gap:13px; max-width:${v.obQ.maxw}; margin:0 auto`)}>
                  {v.obQ.options.map((o, i) => (
                    <button key={i} className="lf-btn" onClick={o.onClick} style={S(`padding:${v.obQ.pad}; border-radius:15px; border:1.5px solid ${o.border}; background:${o.bg}; color:${o.text}; cursor:pointer; text-align:left; display:flex; align-items:center; gap:13px; box-shadow:${o.shadow}`)}>
                      {o.emoji && <span style={S('font-size:24px')}>{o.icon}</span>}
                      <span style={S('display:flex; flex-direction:column; gap:3px')}><span style={S('font-size:16px; font-weight:600')}>{o.label}</span>{o.hasDesc && <span style={S('font-size:13px; opacity:.7; font-weight:400')}>{o.desc}</span>}</span>
                    </button>
                  ))}
                </div>
                {v.obQ.showCustomInput && (
                  <div style={S('max-width:' + v.obQ.maxw + '; margin:14px auto 0; display:flex; gap:10px')}>
                    <input
                      value={this.state.obCustom}
                      onChange={(ev) => this.setState({ obCustom: ev.target.value })}
                      onKeyDown={(ev) => { if (ev.key === 'Enter' && this.state.obCustom.trim()) this.obSelect('topic', this.state.obCustom.trim(), 2)() }}
                      placeholder="Or type your own goal, e.g. &quot;React Native Developer&quot;"
                      style={S('flex:1; padding:13px 16px; border-radius:12px; border:1.5px solid var(--border); background:var(--surface-2); color:var(--text); font-size:14.5px; outline:none; font-family:inherit')}
                    />
                    <button
                      className="lf-btn"
                      onClick={() => { if (this.state.obCustom.trim()) this.obSelect('topic', this.state.obCustom.trim(), 2)() }}
                      style={S('padding:13px 18px; border-radius:12px; border:none; background:var(--text); color:var(--bg); font-weight:600; font-size:14.5px; cursor:pointer; white-space:nowrap')}
                    >Continue →</button>
                  </div>
                )}
                <div style={S('margin-top:34px; display:flex; gap:12px; justify-content:center')}>
                  {v.obCanBack && <button className="lf-btn" onClick={v.obBack} style={S('padding:12px 22px; border-radius:12px; border:1px solid var(--border); background:var(--surface); color:var(--muted); font-weight:600; font-size:15px; cursor:pointer')}>Back</button>}
                </div>
              </div>
            )}

            {v.obGenerating && (
              <div className="lf-screen" style={S('text-align:center')}>
                <div style={S('position:relative; width:120px; height:120px; margin:0 auto 30px')}>
                  <svg width="120" height="120" viewBox="0 0 120 120" style={S('transform:rotate(-90deg)')}><circle cx="60" cy="60" r="52" fill="none" stroke="var(--surface-2)" strokeWidth="8" /><circle cx="60" cy="60" r="52" fill="none" stroke="url(#obg)" strokeWidth="8" strokeLinecap="round" strokeDasharray="327" strokeDashoffset="80" style={S('animation:lf-spin 1.1s linear infinite; transform-origin:center')} /><defs><linearGradient id="obg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="var(--blue)" /><stop offset="1" stopColor="var(--violet)" /></linearGradient></defs></svg>
                  <div style={S('position:absolute; inset:0; display:flex; align-items:center; justify-content:center')}><svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" /></svg></div>
                </div>
                <h1 style={S('font-size:34px; font-weight:800; letter-spacing:-.03em; margin:0 0 10px')}>Mentor AI is building your roadmap…</h1>
                <p style={S('font-size:16px; color:var(--muted); margin:0 0 28px')}>Analyzing {v.obData.topic} · {v.obData.level} · {v.obData.goal}</p>
                <div style={S('max-width:420px; margin:0 auto; display:flex; flex-direction:column; gap:11px')}>
                  {v.obGenSteps.map((g, i) => (
                    <div key={i} style={S(`display:flex; align-items:center; gap:12px; padding:13px 16px; border-radius:13px; background:var(--surface); border:1px solid var(--border); text-align:left; opacity:${g.opacity}; transition:opacity .4s`)}>
                      <span style={S(`width:20px; height:20px; border-radius:99px; background:${g.dot}; flex:none; display:flex; align-items:center; justify-content:center`)}>{g.done && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>}</span>
                      <span style={S('font-size:14.5px; font-weight:500')}>{g.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {v.obDone && (
              <div className="lf-screen" style={S('text-align:center')}>
                <div style={S('width:72px; height:72px; border-radius:99px; background:var(--emerald-soft); display:flex; align-items:center; justify-content:center; margin:0 auto 24px; animation:lf-pop .5s both')}><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--emerald)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg></div>
                <h1 style={S('font-size:38px; font-weight:800; letter-spacing:-.03em; margin:0 0 12px')}>Your roadmap is ready</h1>
                <p style={S('font-size:17px; color:var(--muted); margin:0 0 30px')}>{this.state.roadmap ? `A ${this.state.roadmap.totalWeeks}-week path` : 'A personalised path'} to <b style={S('color:var(--text)')}>{v.obData.topic}</b>, built around {v.obData.time}.</p>
                <div style={S('display:flex; gap:12px; justify-content:center')}>
                  <button className="lf-btn" onClick={v.goTo.roadmap} style={S('padding:15px 26px; border-radius:13px; border:none; background:linear-gradient(135deg,var(--blue),var(--blue-ink)); color:#fff; font-weight:600; font-size:16px; cursor:pointer; box-shadow:var(--shadow)')}>View my roadmap</button>
                  <button className="lf-btn" onClick={v.goTo.dashboard} style={S('padding:15px 24px; border-radius:13px; border:1px solid var(--border-strong); background:var(--surface); color:var(--text); font-weight:600; font-size:16px; cursor:pointer')}>Go to dashboard</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  renderAuth(v) {
    const { authMode, authEmail, authPassword, authError, authLoading } = this.state
    const isSignUp = authMode === 'signup'
    return (
      <div className="lf-screen" style={S('min-height:100vh; display:flex; align-items:center; justify-content:center; padding:24px; background:var(--bg)')}>
        <div style={S('width:100%; max-width:420px')}>
          {/* Logo */}
          <div style={S('display:flex; align-items:center; gap:10px; justify-content:center; margin-bottom:36px')}>
            <div style={S('width:38px; height:38px; border-radius:11px; background:linear-gradient(135deg,var(--blue),var(--violet)); display:flex; align-items:center; justify-content:center; box-shadow:var(--shadow)')}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7l8-4 8 4-8 4-8-4z" /><path d="M4 7v6l8 4 8-4V7" /></svg>
            </div>
            <span style={S('font-weight:800; font-size:20px; letter-spacing:-.02em')}>LearnFlow<span style={S('color:var(--blue)')}> AI</span></span>
          </div>

          {/* Card */}
          <div style={S('border-radius:24px; background:var(--surface); border:1px solid var(--border); padding:32px; box-shadow:var(--shadow-lg)')}>
            <h1 style={S('font-size:26px; font-weight:800; letter-spacing:-.03em; margin:0 0 6px; text-align:center')}>
              {isSignUp ? 'Create your account' : 'Welcome back'}
            </h1>
            <p style={S('font-size:14.5px; color:var(--muted); text-align:center; margin:0 0 26px')}>
              {isSignUp ? 'Start learning smarter — free forever.' : 'Sign in to continue your journey.'}
            </p>

            <div style={S('display:flex; flex-direction:column; gap:13px')}>
              {isSignUp && (
                <input
                  type="text"
                  placeholder="Your name"
                  value={this.state.authName}
                  onChange={(ev) => this.setState({ authName: ev.target.value, authError: '' })}
                  onKeyDown={(ev) => { if (ev.key === 'Enter') this.doAuth() }}
                  style={S('padding:13px 16px; border-radius:12px; border:1.5px solid var(--border); background:var(--surface-2); color:var(--text); font-size:15px; outline:none; font-family:inherit')}
                />
              )}
              <input
                type="email"
                placeholder="you@email.com"
                value={authEmail}
                onChange={(ev) => this.setState({ authEmail: ev.target.value, authError: '' })}
                onKeyDown={(ev) => { if (ev.key === 'Enter') this.doAuth() }}
                style={S('padding:13px 16px; border-radius:12px; border:1.5px solid var(--border); background:var(--surface-2); color:var(--text); font-size:15px; outline:none; font-family:inherit')}
              />
              <input
                type="password"
                placeholder={isSignUp ? 'Create a password (6+ chars)' : 'Your password'}
                value={authPassword}
                onChange={(ev) => this.setState({ authPassword: ev.target.value, authError: '' })}
                onKeyDown={(ev) => { if (ev.key === 'Enter') this.doAuth() }}
                style={S('padding:13px 16px; border-radius:12px; border:1.5px solid var(--border); background:var(--surface-2); color:var(--text); font-size:15px; outline:none; font-family:inherit')}
              />
              {authError && (
                <div style={S('padding:11px 14px; border-radius:11px; background:var(--amber-soft); border:1px solid var(--amber); font-size:13.5px; color:var(--text); line-height:1.45')}>
                  {authError}
                </div>
              )}
              <button
                className="lf-btn"
                onClick={() => this.doAuth()}
                disabled={authLoading}
                style={S('padding:14px; border-radius:12px; border:none; background:linear-gradient(135deg,var(--blue),var(--violet)); color:#fff; font-weight:700; font-size:15px; cursor:pointer; opacity:' + (authLoading ? '.7' : '1'))}
              >
                {authLoading ? 'Please wait…' : (isSignUp ? 'Create account' : 'Sign in')}
              </button>
            </div>

            <div style={S('margin-top:20px; text-align:center; font-size:14px; color:var(--muted)')}>
              {isSignUp ? 'Already have an account? ' : 'New here? '}
              <span
                onClick={() => this.setState({ authMode: isSignUp ? 'signin' : 'signup', authError: '' })}
                style={S('color:var(--blue); font-weight:600; cursor:pointer')}
              >
                {isSignUp ? 'Sign in' : 'Create account'}
              </span>
            </div>
          </div>

          {/* Skip */}
          <div style={S('text-align:center; margin-top:20px')}>
            <span
              onClick={v.goTo.onboarding}
              style={S('font-size:13.5px; color:var(--muted); cursor:pointer; font-weight:500')}
            >
              Continue without an account →
            </span>
          </div>
          <div style={S('text-align:center; margin-top:10px')}>
            <span onClick={v.goTo.landing} style={S('font-size:12px; color:var(--subtle); cursor:pointer')}>← Back to home</span>
          </div>
        </div>
      </div>
    )
  }

  renderApp(v) {
    return (
      <div style={S('display:flex; min-height:100vh')}>
        <aside style={S('width:248px; flex:none; border-right:1px solid var(--border); background:var(--surface); display:flex; flex-direction:column; position:sticky; top:0; height:100vh')}>
          <div style={S('padding:22px 20px 16px; display:flex; align-items:center; gap:11px')}>
            <div style={S('width:34px; height:34px; border-radius:10px; background:linear-gradient(135deg,var(--blue),var(--violet)); display:flex; align-items:center; justify-content:center; box-shadow:var(--shadow-sm)')}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7l8-4 8 4-8 4-8-4z" /><path d="M4 7v6l8 4 8-4V7" /></svg></div>
            <span style={S('font-weight:800; font-size:17px; letter-spacing:-.02em')}>LearnFlow<span style={S('color:var(--blue)')}> AI</span></span>
          </div>
          <div className="lf-scroll" style={S('flex:1; overflow-y:auto; padding:8px 12px; display:flex; flex-direction:column; gap:2px')}>
            <div style={S('font-size:11px; font-weight:700; color:var(--subtle); letter-spacing:.08em; padding:12px 12px 6px')}>MENU</div>
            {v.nav.map((n, i) => (
              <div key={i} className="lf-nav-item" onClick={n.onClick} style={S(`display:flex; align-items:center; gap:12px; padding:10px 12px; border-radius:11px; cursor:pointer; background:${n.bg}; color:${n.color}; font-weight:${n.weight}; font-size:14.5px; position:relative`)}>
                {n.active && <span style={S('position:absolute; left:-12px; top:50%; transform:translateY(-50%); width:4px; height:20px; border-radius:99px; background:var(--blue)')} />}
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" style={S('flex:none')}><path d={n.icon} /></svg>
                <span>{n.label}</span>
                {n.badge && <span style={S('margin-left:auto; font-size:11px; font-weight:700; padding:2px 7px; border-radius:99px; background:var(--blue-soft); color:var(--blue-ink)')}>{n.badgeText}</span>}
              </div>
            ))}
          </div>
          <div style={S('padding:14px; border-top:1px solid var(--border)')}>
            <div onClick={v.goTo.settings} className="lf-nav-item" style={S('display:flex; align-items:center; gap:11px; padding:9px; border-radius:12px; cursor:pointer')}>
              <div style={S('width:34px; height:34px; border-radius:99px; background:linear-gradient(135deg,var(--emerald),var(--blue)); color:#fff; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:13px')}>{this.getInitials(this.state.userName)}</div>
              <div style={S('flex:1; min-width:0')}><div style={S('font-size:13.5px; font-weight:600; white-space:nowrap')}>{this.state.userName || 'Alex Carter'}</div><div style={S('font-size:12px; color:var(--subtle)')}>{this.state.progress.streak > 0 ? this.state.progress.streak + '-day streak 🔥' : 'Start your streak!'}</div></div>
            </div>
          </div>
        </aside>

        <div style={S('flex:1; min-width:0; display:flex; flex-direction:column')}>
          <header style={S('height:64px; flex:none; border-bottom:1px solid var(--border); background:var(--glass); backdrop-filter:blur(14px); position:sticky; top:0; z-index:20; display:flex; align-items:center; gap:16px; padding:0 26px')}>
            <div style={S('font-size:18px; font-weight:700; letter-spacing:-.02em')}>{v.screenTitle}</div>
            <div style={S('flex:1; max-width:420px; margin-left:14px; position:relative')}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--subtle)" strokeWidth="2" strokeLinecap="round" style={S('position:absolute; left:14px; top:50%; transform:translateY(-50%)')}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
              <input placeholder="Search skills, courses, resources…" style={S('width:100%; padding:9px 14px 9px 38px; border-radius:11px; border:1px solid var(--border); background:var(--surface-2); color:var(--text); font-size:14px; outline:none')} />
            </div>
            <div style={S('margin-left:auto; display:flex; align-items:center; gap:10px')}>
              <button className="lf-btn" onClick={v.goTo.mentor} style={S('padding:9px 15px; border-radius:11px; border:none; background:linear-gradient(135deg,var(--blue),var(--violet)); color:#fff; font-weight:600; font-size:13.5px; cursor:pointer; display:flex; align-items:center; gap:7px')}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" /></svg>Ask Mentor</button>
              <button className="lf-btn" onClick={v.toggleTheme} style={S('width:40px; height:40px; border-radius:11px; border:1px solid var(--border); background:var(--surface); color:var(--text); cursor:pointer; display:flex; align-items:center; justify-content:center')}>{v.themeIcon}</button>
              <button className="lf-btn" style={S('width:40px; height:40px; border-radius:11px; border:1px solid var(--border); background:var(--surface); color:var(--muted); cursor:pointer; display:flex; align-items:center; justify-content:center; position:relative')}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></svg><span style={S('position:absolute; top:9px; right:10px; width:7px; height:7px; border-radius:99px; background:var(--amber); border:2px solid var(--surface)')} /></button>
            </div>
          </header>

          <main className="lf-scroll" style={S('flex:1; overflow-y:auto; padding:28px')}>
            {v.isDashboard && <div className="lf-screen">{this.buildDashboard()}</div>}
            {v.isRoadmap && <div className="lf-screen">{this.buildRoadmap()}</div>}
            {v.isPlanner && <div className="lf-screen">{this.buildPlanner()}</div>}
            {v.isAnalytics && <div className="lf-screen">{this.buildAnalytics()}</div>}
            {v.isSkilltree && <div className="lf-screen">{this.buildSkillTree()}</div>}
            {v.isLibrary && <div className="lf-screen">{this.buildLibrary()}</div>}
            {v.isGoals && <div className="lf-screen">{this.buildGoals()}</div>}
            {v.isSettings && <div className="lf-screen">{this.buildSettings()}</div>}
            {v.isMobile && <div className="lf-screen">{this.buildMobile()}</div>}
          </main>
        </div>
      </div>
    )
  }

  renderMentor(v) {
    return (
      <div className="lf-screen" style={S('min-height:100vh; display:flex')}>
        <aside style={S('width:248px; flex:none; border-right:1px solid var(--border); background:var(--surface); display:flex; flex-direction:column; position:sticky; top:0; height:100vh')}>
          <div style={S('padding:22px 20px 16px; display:flex; align-items:center; gap:11px')}>
            <div style={S('width:34px; height:34px; border-radius:10px; background:linear-gradient(135deg,var(--blue),var(--violet)); display:flex; align-items:center; justify-content:center')}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7l8-4 8 4-8 4-8-4z" /><path d="M4 7v6l8 4 8-4V7" /></svg></div>
            <span style={S('font-weight:800; font-size:17px')}>LearnFlow<span style={S('color:var(--blue)')}> AI</span></span>
          </div>
          <div style={S('padding:12px')}><button className="lf-btn" onClick={v.newChat} style={S('width:100%; padding:11px; border-radius:12px; border:1px solid var(--border-strong); background:var(--surface); color:var(--text); font-weight:600; font-size:14px; cursor:pointer; display:flex; align-items:center; gap:8px; justify-content:center')}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>New conversation</button></div>
          <div className="lf-scroll" style={S('flex:1; overflow-y:auto; padding:8px 12px')}>
            <div style={S('font-size:11px; font-weight:700; color:var(--subtle); letter-spacing:.08em; padding:10px 10px 6px')}>RECENT</div>
            {v.chatHistory.map((h, i) => (
              <div key={i} className="lf-nav-item" style={S('padding:10px 11px; border-radius:10px; cursor:pointer; font-size:13.5px; color:var(--muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis')}>{h}</div>
            ))}
          </div>
          <div style={S('padding:12px')}><button className="lf-btn" onClick={v.goTo.dashboard} style={S('width:100%; padding:10px; border-radius:11px; border:1px solid var(--border); background:var(--surface-2); color:var(--muted); font-size:13.5px; font-weight:600; cursor:pointer; display:flex; align-items:center; gap:8px; justify-content:center')}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>Back to app</button></div>
        </aside>

        <div style={S('flex:1; min-width:0; display:flex; flex-direction:column; background:var(--bg)')}>
          <header style={S('height:64px; flex:none; border-bottom:1px solid var(--border); display:flex; align-items:center; gap:12px; padding:0 26px')}>
            <div style={S('width:30px; height:30px; border-radius:9px; background:linear-gradient(135deg,var(--blue),var(--violet)); display:flex; align-items:center; justify-content:center')}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" /></svg></div>
            <div><div style={S('font-size:15px; font-weight:700')}>Mentor AI</div><div style={S('font-size:12px; color:var(--emerald); display:flex; align-items:center; gap:5px')}><span style={S('width:6px;height:6px;border-radius:99px;background:var(--emerald)')} />Online · grounded on your roadmap</div></div>
            <button className="lf-btn" onClick={v.toggleTheme} style={S('margin-left:auto; width:38px; height:38px; border-radius:11px; border:1px solid var(--border); background:var(--surface); color:var(--text); cursor:pointer; display:flex; align-items:center; justify-content:center')}>{v.themeIcon}</button>
          </header>
          <div className="lf-scroll" style={S('flex:1; overflow-y:auto; padding:30px 26px')}>
            <div style={S('max-width:760px; margin:0 auto')}>{this.buildChat()}</div>
          </div>
          <div style={S('flex:none; padding:18px 26px 24px; border-top:1px solid var(--border); background:var(--surface)')}>
            <div style={S('max-width:760px; margin:0 auto')}>
              <div style={S('display:flex; gap:9px; margin-bottom:12px; flex-wrap:wrap')}>
                {v.chatSuggestions.map((s, i) => (
                  <button key={i} className="lf-btn" onClick={s.onClick} style={S('padding:8px 13px; border-radius:99px; border:1px solid var(--border); background:var(--surface-2); color:var(--muted); font-size:13px; font-weight:500; cursor:pointer')}>{s.text}</button>
                ))}
              </div>
              <div style={S('display:flex; gap:10px; align-items:flex-end; border:1.5px solid var(--border-strong); border-radius:16px; padding:8px 8px 8px 16px; background:var(--bg)')}>
                <input value={v.chatInput} onChange={v.onChatInput} onKeyDown={v.onChatKey} placeholder="Ask Mentor AI anything about your learning path…" style={S('flex:1; border:none; background:transparent; color:var(--text); font-size:15px; outline:none; padding:8px 0')} />
                <button className="lf-btn" onClick={v.sendChat} style={S('width:40px; height:40px; border-radius:11px; border:none; background:var(--blue); color:#fff; cursor:pointer; display:flex; align-items:center; justify-content:center; flex:none')}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg></button>
              </div>
              <div style={S('text-align:center; font-size:11.5px; color:var(--subtle); margin-top:10px')}>Mentor AI grounds answers in your roadmap and verified sources.</div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ===== CHAT ELEMENT =====
  buildChat() {
    const msgs = this.state.chatMsgs
    if (msgs.length === 0 && !this.state.chatTyping) {
      return e('div', { style: { textAlign: 'center', padding: '40px 0' } },
        e('div', { style: { width: 64, height: 64, borderRadius: 18, margin: '0 auto 22px', background: 'linear-gradient(135deg,var(--blue),var(--violet))', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: 'var(--shadow)' } },
          e('svg', { width: 32, height: 32, viewBox: '0 0 24 24', fill: 'none', stroke: '#fff', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }, e('path', { d: 'M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1' }))),
        e('h2', { style: { fontSize: 30, fontWeight: 800, letterSpacing: '-.03em', margin: '0 0 10px' } }, 'How can I help you learn today?'),
        e('p', { style: { fontSize: 16, color: 'var(--muted)', margin: '0 auto', maxWidth: 440 } }, "Ask about your Azure roadmap, get a study plan, generate a quiz, or check if you're on track. Every answer is grounded in your data.")
      )
    }
    const bubbles = msgs.map((m, i) => m.role === 'user'
      ? e('div', { key: i, style: { display: 'flex', justifyContent: 'flex-end', marginBottom: 22 } },
          e('div', { style: { maxWidth: '78%', padding: '13px 17px', borderRadius: '18px 18px 4px 18px', background: 'var(--blue)', color: '#fff', fontSize: 15, lineHeight: 1.5 } }, m.text))
      : e('div', { key: i, style: { display: 'flex', gap: 13, marginBottom: 26, animation: 'lf-fade .4s both' } },
          e('div', { style: { width: 32, height: 32, flex: 'none', borderRadius: 9, background: 'linear-gradient(135deg,var(--blue),var(--violet))', display: 'flex', alignItems: 'center', justifyContent: 'center' } },
            e('svg', { width: 17, height: 17, viewBox: '0 0 24 24', fill: 'none', stroke: '#fff', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }, e('path', { d: 'M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1' }))),
          e('div', { style: { flex: 1, minWidth: 0 } },
            e('div', { style: { fontSize: 13, fontWeight: 700, marginBottom: 8, color: 'var(--text)' } }, 'Mentor AI'),
            e('div', { style: { fontSize: 15, lineHeight: 1.62, color: 'var(--text)' } }, this.fmt(m.text)),
            m.bullets && m.bullets.length ? e('div', { style: { margin: '14px 0 4px', display: 'flex', flexDirection: 'column', gap: 9 } },
              m.bullets.map((b, bi) => e('div', { key: bi, style: { display: 'flex', gap: 11, fontSize: 14.5, lineHeight: 1.5 } },
                e('span', { style: { width: 22, height: 22, flex: 'none', borderRadius: 7, background: 'var(--blue-soft)', color: 'var(--blue-ink)', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' } }, bi + 1),
                e('span', { style: { color: 'var(--text)' } }, this.fmt(b))))
            ) : null,
            m.sources && m.sources.length ? e('div', { style: { marginTop: 18 } },
              e('div', { style: { fontSize: 12, fontWeight: 700, color: 'var(--subtle)', letterSpacing: '.06em', marginBottom: 9, display: 'flex', alignItems: 'center', gap: 7 } },
                e('svg', { width: 13, height: 13, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }, e('path', { d: 'M6 4h10v16H8a2 2 0 0 0-2 2zM6 4v18' })), 'SOURCES'),
              e('div', { style: { display: 'flex', gap: 10, flexWrap: 'wrap' } },
                m.sources.map((s, si) => e('div', { key: si, style: { flex: '1 1 200px', minWidth: 180, padding: '11px 13px', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer' } },
                  e('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 } },
                    e('span', { style: { width: 18, height: 18, borderRadius: 6, background: 'var(--blue-soft)', color: 'var(--blue-ink)', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' } }, si + 1),
                    e('span', { style: { fontSize: 13, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, s.t)),
                  e('div', { style: { fontSize: 11.5, color: 'var(--subtle)' } }, s.m))))
            ) : null
          ))
    )
    if (this.state.chatTyping) {
      bubbles.push(e('div', { key: 'typing', style: { display: 'flex', gap: 13, marginBottom: 26 } },
        e('div', { style: { width: 32, height: 32, flex: 'none', borderRadius: 9, background: 'linear-gradient(135deg,var(--blue),var(--violet))', display: 'flex', alignItems: 'center', justifyContent: 'center' } },
          e('svg', { width: 17, height: 17, viewBox: '0 0 24 24', fill: 'none', stroke: '#fff', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }, e('path', { d: 'M12 3v3M12 18v3M3 12h3M18 12h3' }))),
        e('div', { style: { display: 'flex', gap: 5, alignItems: 'center', padding: '14px 4px' } },
          [0, 1, 2].map((d) => e('span', { key: d, style: { width: 8, height: 8, borderRadius: 99, background: 'var(--subtle)', animation: 'lf-blink 1.2s infinite', animationDelay: (d * 0.18) + 's' } })))
      ))
    }
    return e('div', {}, bubbles)
  }

  // ===== DASHBOARD =====
  buildDashboard() {
    const rm = this.state.roadmap
    const phases = this.roadmapData()
    const days = [['M', 60], ['T', 85], ['W', 45], ['T', 92], ['F', 70], ['S', 100], ['S', 38]]
    const max = 100
    const { streak: realStreak, hoursStudied: realHours } = this.state.progress
    const displayName = this.state.userName || 'Alex'

    // Today's tasks — from state.tasks (persisted), roadmap, or mock
    const currentTasks = this.state.tasks
      || (rm && rm.todaysTasks && rm.todaysTasks.length > 0 ? rm.todaysTasks : null)
      || LearnFlow.MOCK_TASKS
    const doneTasks = currentTasks.filter((t) => t.done).length

    // Stats: real when roadmap exists, mock otherwise
    const score = Math.min(999, Math.round(realHours * 100 + doneTasks * 50))
    const scorePct = Math.min(100, Math.round(realHours * 10 + doneTasks * 5))
    const streak = realStreak
    const hoursDisplay = parseFloat(realHours.toFixed(1))
    const r = this.ring(scorePct, 52)

    // Greeting copy
    const greetText = rm
      ? `Your ${rm.headline} roadmap is ready! 🎯`
      : `Welcome${displayName !== 'Alex' ? ', ' + displayName : ''} 👋`
    const greetSub = rm && streak === 0
      ? `${rm.totalWeeks}-week plan, ${rm.hoursPerDay}/day — complete your first tasks to start your streak.`
      : rm
      ? `${streak}-day streak 🔥 Keep it up — ${currentTasks.length - doneTasks} tasks left today.`
      : 'Generate your roadmap to get personalised tasks, goals and Mentor AI guidance.'

    // Active learning paths
    const activePaths = rm
      ? [{ t: rm.headline, s: 'Phase 1 of ' + phases.length + ' · ' + (phases[0] ? phases[0].cert : ''), p: phases[0]?.pct || 0, c: 'var(--blue)' }]
      : []

    // Upcoming milestones
    const milestonePalette = ['var(--blue)', 'var(--violet)', 'var(--violet)', 'var(--amber)']
    const milestones = rm && rm.milestones && rm.milestones.length > 0
      ? rm.milestones.map((m, i) => ({ t: m.t, d: m.d, st: i === 0 ? 'current' : 'next', c: milestonePalette[i] || 'var(--violet)' }))
      : []

    return e('div', { style: { display: 'flex', flexDirection: 'column', gap: 20 } },
      e('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 14 } },
        e('div', {},
          e('div', { style: { fontSize: 26, fontWeight: 800, letterSpacing: '-.03em' } }, greetText),
          e('div', { style: { fontSize: 15, color: 'var(--muted)', marginTop: 4 } }, greetSub)),
        e('button', { className: 'lf-btn', onClick: this.go('mentor'), style: { padding: '11px 18px', borderRadius: 12, border: 'none', background: 'var(--text)', color: 'var(--bg)', fontWeight: 600, fontSize: 14, cursor: 'pointer' } }, 'Generate weekly review')
      ),
      e('div', { style: { display: 'grid', gridTemplateColumns: '1.15fr 1fr 1fr 1fr', gap: 16 } },
        e('div', { style: { borderRadius: 20, padding: 22, background: 'linear-gradient(150deg,var(--blue),var(--violet))', color: '#fff', boxShadow: 'var(--shadow)', display: 'flex', alignItems: 'center', gap: 18 } },
          e('div', { style: { position: 'relative', width: 104, height: 104, flex: 'none' } },
            e('svg', { width: 104, height: 104, viewBox: '0 0 116 116', style: { transform: 'rotate(-90deg)' } },
              e('circle', { cx: 58, cy: 58, r: 52, fill: 'none', stroke: 'rgba(255,255,255,.25)', strokeWidth: 9 }),
              e('circle', { cx: 58, cy: 58, r: 52, fill: 'none', stroke: '#fff', strokeWidth: 9, strokeLinecap: 'round', strokeDasharray: r.c, strokeDashoffset: r.off })),
            e('div', { style: { position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' } },
              e('span', { style: { fontSize: 28, fontWeight: 800, lineHeight: 1 } }, score), e('span', { style: { fontSize: 11, opacity: .85 } }, '/ 1000'))),
          e('div', {},
            e('div', { style: { fontSize: 13, opacity: .85, fontWeight: 600 } }, 'Learning Score'),
            e('div', { style: { fontSize: 15, fontWeight: 700, margin: '6px 0 4px' } }, '▲ 34 this week'),
            e('div', { style: { fontSize: 13, opacity: .9 } }, 'Top 8% of learners'))),
        ...[
          { label: 'Learning Streak', val: String(streak), unit: 'days', sub: streak > 0 ? 'Keep going! 💪' : 'Start today!', ic: 'M12 2c1 3 4 4 4 8a4 4 0 0 1-8 0c0-1 .5-2 1-2.5C9 9 12 8 12 2z', cl: 'var(--amber)', sf: 'var(--amber-soft)' },
          { label: 'Time Invested', val: String(hoursDisplay), unit: 'hrs', sub: doneTasks + ' tasks done today', ic: 'M12 6v6l4 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', cl: 'var(--blue)', sf: 'var(--blue-soft)' },
          { label: 'Tasks today', val: String(doneTasks + '/' + currentTasks.length), unit: '', sub: doneTasks === currentTasks.length && currentTasks.length > 0 ? 'All done! 🎉' : currentTasks.length - doneTasks + ' remaining', ic: 'M20 6 9 17l-5-5', cl: 'var(--emerald)', sf: 'var(--emerald-soft)' },
        ].map((s, i) => e('div', { key: i, className: 'lf-card-h', style: { borderRadius: 20, background: 'var(--surface)', border: '1px solid var(--border)', padding: 20, boxShadow: 'var(--shadow-sm)' } },
          e('div', { style: { width: 38, height: 38, borderRadius: 11, background: s.sf, color: s.cl, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14 } },
            e('svg', { width: 19, height: 19, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }, e('path', { d: s.ic }))),
          e('div', { style: { fontSize: 13, color: 'var(--muted)', fontWeight: 500 } }, s.label),
          e('div', { style: { display: 'flex', alignItems: 'baseline', gap: 5, margin: '4px 0 2px' } }, e('span', { style: { fontSize: 30, fontWeight: 800, letterSpacing: '-.03em' } }, s.val), e('span', { style: { fontSize: 14, color: 'var(--subtle)', fontWeight: 600 } }, s.unit)),
          e('div', { style: { fontSize: 12.5, color: 'var(--emerald)', fontWeight: 600 } }, s.sub)))
      ),
      e('div', { style: { display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 16 } },
        e('div', { style: { display: 'flex', flexDirection: 'column', gap: 16 } },
          e('div', { style: { borderRadius: 20, background: 'var(--surface)', border: '1px solid var(--border)', padding: 22, boxShadow: 'var(--shadow-sm)' } },
            e('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 } },
              e('span', { style: { fontSize: 16, fontWeight: 700 } }, 'Active Learning Paths'),
              e('span', { onClick: this.go('roadmap'), style: { fontSize: 13, color: 'var(--blue)', fontWeight: 600, cursor: 'pointer' } }, 'View roadmap →')),
            activePaths.length > 0
              ? e('div', { style: { display: 'flex', flexDirection: 'column', gap: 14 } },
                  activePaths.map((p, i) =>
                    e('div', { key: i, style: { display: 'flex', alignItems: 'center', gap: 16, cursor: 'pointer' }, onClick: this.go('roadmap') },
                      e('div', { style: { position: 'relative', width: 48, height: 48, flex: 'none' } },
                        (() => { const rr = this.ring(p.p, 20); return e('svg', { width: 48, height: 48, viewBox: '0 0 48 48', style: { transform: 'rotate(-90deg)' } },
                          e('circle', { cx: 24, cy: 24, r: 20, fill: 'none', stroke: 'var(--surface-3)', strokeWidth: 5 }),
                          e('circle', { cx: 24, cy: 24, r: 20, fill: 'none', stroke: p.c, strokeWidth: 5, strokeLinecap: 'round', strokeDasharray: rr.c, strokeDashoffset: rr.off })) })(),
                        e('div', { style: { position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700 } }, p.p + '%')),
                      e('div', { style: { flex: 1 } }, e('div', { style: { fontSize: 15, fontWeight: 600 } }, p.t), e('div', { style: { fontSize: 13, color: 'var(--muted)', marginTop: 2 } }, p.s)),
                      e('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'var(--subtle)', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }, e('path', { d: 'M9 6l6 6-6 6' })))))
              : e('div', { style: { textAlign: 'center', padding: '20px 0', color: 'var(--muted)', fontSize: 14 } },
                  e('div', { style: { marginBottom: 10 } }, 'No active roadmap yet.'),
                  e('span', { onClick: this.go('onboarding'), style: { color: 'var(--blue)', fontWeight: 600, cursor: 'pointer' } }, 'Build my roadmap →'))),
          e('div', { style: { borderRadius: 20, background: 'var(--surface)', border: '1px solid var(--border)', padding: 22, boxShadow: 'var(--shadow-sm)' } },
            e('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 } },
              e('span', { style: { fontSize: 16, fontWeight: 700 } }, 'Weekly Progress'),
              e('span', { style: { fontSize: 13, color: 'var(--muted)' } }, 'Minutes studied · this week')),
            e('div', { style: { display: 'flex', alignItems: 'flex-end', gap: 12, height: 140 } },
              days.map((d, i) => e('div', { key: i, style: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, height: '100%', justifyContent: 'flex-end' } },
                e('div', { style: { width: '100%', maxWidth: 34, height: (d[1] / max * 108) + 'px', borderRadius: 8, background: i === 5 ? 'linear-gradient(var(--blue),var(--violet))' : 'var(--blue-soft)', transformOrigin: 'bottom', animation: 'lf-rise .6s ' + (i * 0.05) + 's both cubic-bezier(.22,1,.36,1)' } }),
                e('span', { style: { fontSize: 12, color: 'var(--subtle)', fontWeight: 600 } }, d[0])))))),
        e('div', { style: { display: 'flex', flexDirection: 'column', gap: 16 } },
          e('div', { style: { borderRadius: 20, background: 'var(--surface)', border: '1px solid var(--border)', padding: 22, boxShadow: 'var(--shadow-sm)' } },
            e('div', { style: { fontSize: 16, fontWeight: 700, marginBottom: 16 } }, "Today's Tasks"),
            e('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
              currentTasks.map((task, i) =>
                e('div', { key: i, onClick: this.toggleTask(i), className: 'lf-btn', style: { display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 12, background: task.done ? 'var(--surface-2)' : 'transparent', border: '1px solid ' + (task.done ? 'transparent' : 'var(--border)'), cursor: 'pointer' } },
                  e('span', { style: { width: 20, height: 20, flex: 'none', borderRadius: 7, border: task.done ? 'none' : '2px solid var(--border-strong)', background: task.done ? 'var(--emerald)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all .2s' } },
                    task.done ? e('svg', { width: 12, height: 12, viewBox: '0 0 24 24', fill: 'none', stroke: '#fff', strokeWidth: 3.5, strokeLinecap: 'round', strokeLinejoin: 'round' }, e('path', { d: 'M20 6 9 17l-5-5' })) : null),
                  e('span', { style: { flex: 1, fontSize: 14, fontWeight: 500, textDecoration: task.done ? 'line-through' : 'none', color: task.done ? 'var(--subtle)' : 'var(--text)', transition: 'all .2s' } }, task.t),
                  e('span', { style: { fontSize: 12, color: 'var(--subtle)', fontWeight: 600 } }, task.d)))),
          ),
          e('div', { style: { borderRadius: 20, padding: 22, background: 'var(--surface)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', position: 'relative', overflow: 'hidden' } },
            e('div', { style: { display: 'flex', alignItems: 'center', gap: 9, marginBottom: 13 } },
              e('div', { style: { width: 28, height: 28, borderRadius: 8, background: 'linear-gradient(135deg,var(--blue),var(--violet))', display: 'flex', alignItems: 'center', justifyContent: 'center' } },
                e('svg', { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: '#fff', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }, e('path', { d: 'M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1' }))),
              e('span', { style: { fontSize: 14, fontWeight: 700 } }, 'Mentor AI suggests')),
            e('div', { style: { fontSize: 14.5, lineHeight: 1.55, color: 'var(--text)', marginBottom: 16 } }, rm && rm.watchAreas && rm.watchAreas[0] ? rm.watchAreas[0] : 'Generate your roadmap to get personalised Mentor AI suggestions based on your learning track.'),
            e('div', { style: { display: 'flex', gap: 9 } },
              e('button', { className: 'lf-btn', style: { flex: 1, padding: '10px', borderRadius: 11, border: 'none', background: 'var(--blue)', color: '#fff', fontWeight: 600, fontSize: 13.5, cursor: 'pointer' } }, 'Reschedule'),
              e('button', { className: 'lf-btn', style: { padding: '10px 14px', borderRadius: 11, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--muted)', fontWeight: 600, fontSize: 13.5, cursor: 'pointer' } }, 'Dismiss')))
        )
      ),
      e('div', { style: { borderRadius: 20, background: 'var(--surface)', border: '1px solid var(--border)', padding: 22, boxShadow: 'var(--shadow-sm)' } },
        e('div', { style: { fontSize: 16, fontWeight: 700, marginBottom: 20 } }, 'Upcoming Milestones'),
        milestones.length > 0
          ? e('div', { style: { display: 'flex', gap: 0, position: 'relative' } },
              milestones.map((m, i, arr) =>
                e('div', { key: i, style: { flex: 1, position: 'relative', paddingTop: 28 } },
                  i < arr.length - 1 ? e('div', { style: { position: 'absolute', top: 9, left: '50%', right: '-50%', height: 2, background: 'var(--border-strong)' } }) : null,
                  e('div', { style: { position: 'absolute', top: 2, left: '50%', transform: 'translateX(-50%)', width: 16, height: 16, borderRadius: 99, background: m.st === 'locked' ? 'var(--surface-3)' : m.c, border: '3px solid var(--surface)', boxShadow: '0 0 0 1px var(--border)' } }),
                  e('div', { style: { textAlign: 'center' } },
                    e('div', { style: { fontSize: 14, fontWeight: 600, color: m.st === 'locked' ? 'var(--subtle)' : 'var(--text)' } }, m.t),
                    e('div', { style: { fontSize: 12.5, color: 'var(--subtle)', marginTop: 2 } }, m.d)))))
          : e('div', { style: { textAlign: 'center', padding: '16px 0', color: 'var(--muted)', fontSize: 14 } },
              'Milestones will appear here once your roadmap is generated.')
      )
    )
  }

  static MOCK_TASKS = [
    { t: 'Review your learning goals for today', d: '10 min', done: false },
    { t: 'Read or watch: core concept for your topic', d: '30 min', done: false },
    { t: 'Complete a practice exercise or quiz', d: '20 min', done: false },
    { t: 'Reflect and take notes on what you learned', d: '10 min', done: false },
  ]

  // Phase color palette — assigned by index so CSS vars stay client-side only.
  static PHASE_COLORS = [
    { color: 'var(--emerald)', soft: 'var(--emerald-soft)' },
    { color: 'var(--blue)', soft: 'var(--blue-soft)' },
    { color: 'var(--violet)', soft: 'var(--violet-soft)' },
    { color: 'var(--amber)', soft: 'var(--amber-soft)' },
  ]

  roadmapData() {
    const rm = this.state.roadmap
    if (rm && Array.isArray(rm.phases) && rm.phases.length > 0) {
      return rm.phases.map((p, i) => {
        const c = LearnFlow.PHASE_COLORS[i % LearnFlow.PHASE_COLORS.length]
        return { ...p, color: c.color, soft: c.soft }
      })
    }
    return []
  }
  buildRoadmap() {
    const rm = this.state.roadmap
    if (!rm) return e('div', { style: { textAlign: 'center', padding: '80px 24px' } },
      e('div', { style: { fontSize: 48, marginBottom: 16 } }, '🗺️'),
      e('div', { style: { fontSize: 20, fontWeight: 700, marginBottom: 8 } }, 'No roadmap yet'),
      e('div', { style: { fontSize: 14.5, color: 'var(--muted)', marginBottom: 24 } }, 'Tell Mentor AI your goal and get a personalised learning roadmap in seconds.'),
      e('button', { className: 'lf-btn', onClick: this.go('onboarding'), style: { padding: '12px 22px', borderRadius: 12, border: 'none', background: 'linear-gradient(135deg,var(--blue),var(--violet))', color: '#fff', fontWeight: 600, fontSize: 14.5, cursor: 'pointer' } }, 'Build my roadmap'))

    const phases = this.roadmapData()
    const selIdx = Math.min(this.state.roadmapPhase, phases.length - 1)
    const sel = phases[selIdx] || phases[0]
    if (!sel) return null

    const col = (title, items, icon, clr) => e('div', { style: { borderRadius: 16, background: 'var(--surface-2)', border: '1px solid var(--border)', padding: 18 } },
      e('div', { style: { display: 'flex', alignItems: 'center', gap: 9, marginBottom: 14 } },
        e('div', { style: { width: 30, height: 30, borderRadius: 9, background: 'var(--surface)', color: clr, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--border)' } },
          e('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }, e('path', { d: icon }))),
        e('span', { style: { fontSize: 14, fontWeight: 700 } }, title)),
      e('div', { style: { display: 'flex', flexDirection: 'column', gap: 9 } },
        items.map((it, i) => e('div', { key: i, style: { display: 'flex', gap: 9, fontSize: 13.5, lineHeight: 1.45, color: 'var(--text)' } },
          e('span', { style: { width: 5, height: 5, borderRadius: 99, background: clr, marginTop: 7, flex: 'none' } }), it))))

    const rmTotalWeeks = rm.totalWeeks
    const rmCompletedWeeks = Math.round(phases.reduce((a, p) => a + (p.pct / 100) * (p.numWeeks || 1), 0))
    const rmOverallPct = Math.round(phases.reduce((a, p) => a + p.pct, 0) / phases.length)
    const rmCurPhase = phases.findIndex((p) => p.status === 'In progress') + 1 || 1
    const rmStats = [['Overall', rmOverallPct + '%'], ['Phase', rmCurPhase + ' of ' + phases.length], ['Streak', this.state.progress.streak + ' days'], ['On track', 'Yes']]

    return e('div', { style: { display: 'flex', flexDirection: 'column', gap: 22 } },
      e('div', { style: { borderRadius: 24, padding: '28px 30px', background: 'linear-gradient(135deg,var(--blue),var(--violet))', color: '#fff', boxShadow: 'var(--shadow)', position: 'relative', overflow: 'hidden' } },
        e('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 20 } },
          e('div', {},
            e('div', { style: { fontSize: 12.5, fontWeight: 700, letterSpacing: '.1em', opacity: .85, marginBottom: 8 } }, 'YOUR LEARNING ROADMAP'),
            e('div', { style: { fontSize: 30, fontWeight: 800, letterSpacing: '-.03em', marginBottom: 6 } }, rm.headline),
            e('div', { style: { fontSize: 15, opacity: .9 } }, rm.totalWeeks + '-week path · ' + rm.hoursPerDay + '/day · Target: ' + rm.targetDate)),
          e('div', { style: { display: 'flex', gap: 26 } },
            rmStats.map((k, i) =>
              e('div', { key: i }, e('div', { style: { fontSize: 24, fontWeight: 800, letterSpacing: '-.02em' } }, k[1]), e('div', { style: { fontSize: 12.5, opacity: .8, marginTop: 2 } }, k[0]))))),
        e('div', { style: { marginTop: 22, display: 'flex', alignItems: 'center', gap: 14 } },
          e('div', { style: { flex: 1, height: 8, borderRadius: 99, background: 'rgba(255,255,255,.25)', overflow: 'hidden' } },
            e('div', { style: { height: '100%', width: rmOverallPct + '%', borderRadius: 99, background: '#fff' } })),
          e('span', { style: { fontSize: 13, fontWeight: 600, opacity: .9 } }, rmCompletedWeeks + ' of ' + rmTotalWeeks + ' weeks'))
      ),
      e('div', { style: { display: 'grid', gridTemplateColumns: '320px 1fr', gap: 22, alignItems: 'start' } },
        e('div', { style: { display: 'flex', flexDirection: 'column', gap: 0, position: 'relative' } },
          phases.map((p, i) => { const active = i === selIdx; return e('div', { key: i, onClick: this.selectPhase(i), className: 'lf-btn', style: { cursor: 'pointer', display: 'flex', gap: 16, paddingBottom: i < phases.length - 1 ? 18 : 0 } },
            e('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center' } },
              e('div', { style: { width: 44, height: 44, flex: 'none', borderRadius: 13, background: active ? p.color : p.soft, color: active ? '#fff' : p.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 16, boxShadow: active ? 'var(--shadow)' : 'none', transition: 'all .3s' } },
                p.pct === 100 ? e('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: '#fff', strokeWidth: 3, strokeLinecap: 'round', strokeLinejoin: 'round' }, e('path', { d: 'M20 6 9 17l-5-5' })) : p.n),
              i < phases.length - 1 ? e('div', { style: { width: 2, flex: 1, minHeight: 40, background: 'var(--border-strong)', marginTop: 6 } }) : null),
            e('div', { style: { flex: 1, padding: '4px 16px', borderRadius: 14, background: active ? 'var(--surface)' : 'transparent', border: active ? '1px solid var(--border)' : '1px solid transparent', boxShadow: active ? 'var(--shadow-sm)' : 'none', transition: 'all .3s' } },
              e('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
                e('span', { style: { fontSize: 15.5, fontWeight: 700 } }, 'Phase ' + p.n + ' · ' + p.title),
                e('span', { style: { fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 99, background: p.soft, color: p.color } }, p.cert)),
              e('div', { style: { fontSize: 13, color: 'var(--muted)', margin: '4px 0 8px' } }, p.sub),
              e('div', { style: { display: 'flex', alignItems: 'center', gap: 9 } },
                e('div', { style: { flex: 1, height: 5, borderRadius: 99, background: 'var(--surface-3)', overflow: 'hidden' } }, e('div', { style: { height: '100%', width: p.pct + '%', borderRadius: 99, background: p.color } })),
                e('span', { style: { fontSize: 12, fontWeight: 600, color: 'var(--muted)' } }, p.pct + '%')))) })),
        e('div', { style: { borderRadius: 22, background: 'var(--surface)', border: '1px solid var(--border)', padding: 26, boxShadow: 'var(--shadow-sm)' } },
          e('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6, flexWrap: 'wrap', gap: 12 } },
            e('div', {},
              e('div', { style: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4, flexWrap: 'wrap' } },
                e('span', { style: { fontSize: 22, fontWeight: 800, letterSpacing: '-.02em' } }, 'Phase ' + sel.n + ': ' + sel.title),
                e('span', { style: { fontSize: 12, fontWeight: 700, padding: '4px 10px', borderRadius: 99, background: sel.soft, color: sel.color } }, sel.status)),
              e('div', { style: { fontSize: 14.5, color: 'var(--muted)' } }, sel.sub + ' · ' + sel.weeks)),
            e('button', { className: 'lf-btn', onClick: this.go('planner'), style: { padding: '10px 16px', borderRadius: 11, border: 'none', background: 'var(--text)', color: 'var(--bg)', fontWeight: 600, fontSize: 13.5, cursor: 'pointer' } }, 'Open in planner')),
          e('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 14, marginTop: 20 } },
            col("Skills you'll gain", sel.skills, 'M12 3v4M6 17l6-6 6 6M10 3h4v4h-4z', sel.color),
            col('Courses & resources', sel.courses, 'M6 4h10v16H8a2 2 0 0 0-2 2zM6 4v18', sel.color),
            col('Hands-on projects', sel.projects, 'M3 7h18M3 7l2 13h14l2-13M9 11v5M15 11v5', sel.color)),
          e('div', { style: { marginTop: 14, display: 'flex', alignItems: 'center', gap: 13, padding: '16px 18px', borderRadius: 14, background: sel.soft, border: '1px solid ' + sel.color } },
            e('div', { style: { width: 36, height: 36, borderRadius: 10, background: 'var(--surface)', color: sel.color, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' } },
              e('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }, e('path', { d: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z' }))),
            e('div', {}, e('div', { style: { fontSize: 12.5, fontWeight: 700, color: sel.color, letterSpacing: '.04em' } }, 'ASSESSMENT'),
              e('div', { style: { fontSize: 14.5, fontWeight: 600, color: 'var(--text)', marginTop: 2 } }, sel.assessment))))
      )
    )
  }

  buildPlanner() {
    const view = this.state.plannerView
    const rm = this.state.roadmap
    const tabs = [['week', 'Week'], ['kanban', 'Board'], ['calendar', 'Month']]

    // Build week from roadmap when available, otherwise show mock
    const now = new Date()
    const dow = now.getDay() // 0=Sun...6=Sat
    const monday = new Date(now); monday.setDate(now.getDate() - (dow === 0 ? 6 : dow - 1))
    const todayIdx = dow === 0 ? 6 : dow - 1 // 0=Mon...6=Sun
    const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    const monthStr = now.toLocaleString('default', { month: 'long' }) + ' ' + now.getFullYear()

    const week = rm ? (() => {
      const phase = rm.phases && rm.phases[0]
      const courses = (phase?.courses || []).map((c, i) => ({ t: c.split(' — ')[0], time: i % 2 === 0 ? '7:00' : '19:30', c: 'var(--blue)', soft: 'var(--blue-soft)' }))
      const projects = (phase?.projects || []).map((p) => ({ t: p, time: '10:00', c: 'var(--emerald)', soft: 'var(--emerald-soft)' }))
      const daytasks = (rm.todaysTasks || []).map((t) => ({ t: t.t, time: '9:00', c: 'var(--violet)', soft: 'var(--violet-soft)' }))
      const pool = [...daytasks, ...courses, ...projects]
      return dayNames.map((d, i) => {
        const date = new Date(monday); date.setDate(monday.getDate() + i)
        const items = i < 5 ? pool.slice(i, i + 1) : i === 5 ? projects.slice(0, 2) : [{ t: 'Weekly review with Mentor AI', time: '18:00', c: 'var(--violet)', soft: 'var(--violet-soft)' }]
        return { d, n: String(date.getDate()), today: i === todayIdx, items }
      })
    })() : [
      { d: 'Mon', n: String(monday.getDate()), today: todayIdx === 0, items: [{ t: 'Load Balancer deep-dive', time: '7:00', c: 'var(--blue)', soft: 'var(--blue-soft)' }, { t: 'Practice set 3', time: '19:30', c: 'var(--violet)', soft: 'var(--violet-soft)' }] },
      { d: 'Tue', n: String(monday.getDate() + 1), today: todayIdx === 1, items: [{ t: 'NSG lab', time: '7:00', c: 'var(--blue)', soft: 'var(--blue-soft)' }] },
      { d: 'Wed', n: String(monday.getDate() + 2), today: todayIdx === 2, items: [{ t: 'AZ-104 mock exam', time: '9:00', c: 'var(--amber)', soft: 'var(--amber-soft)' }, { t: 'Review weak areas', time: '20:00', c: 'var(--violet)', soft: 'var(--violet-soft)' }] },
      { d: 'Thu', n: String(monday.getDate() + 3), today: todayIdx === 3, items: [] },
      { d: 'Fri', n: String(monday.getDate() + 4), today: todayIdx === 4, items: [{ t: 'VNet peering', time: '7:00', c: 'var(--blue)', soft: 'var(--blue-soft)' }] },
      { d: 'Sat', n: String(monday.getDate() + 5), today: todayIdx === 5, items: [{ t: 'Project: hub-spoke net', time: '10:00', c: 'var(--emerald)', soft: 'var(--emerald-soft)' }, { t: 'Reading', time: '15:00', c: 'var(--blue)', soft: 'var(--blue-soft)' }] },
      { d: 'Sun', n: String(monday.getDate() + 6), today: todayIdx === 6, items: [{ t: 'Weekly review w/ AI', time: '18:00', c: 'var(--violet)', soft: 'var(--violet-soft)' }] },
    ]

    const currentTasks = this.state.tasks || (rm && rm.todaysTasks) || LearnFlow.MOCK_TASKS
    const kb = rm ? (() => {
      const phase = rm.phases && rm.phases[0]
      const phaseLabel = phase ? phase.title : 'Phase 1'
      return [
        { col: 'To do', c: 'var(--subtle)', cards: currentTasks.filter((t) => !t.done).map((t) => ({ t: t.t, m: phaseLabel + ' · ' + t.d, c: 'var(--blue)' })).concat((phase?.courses || []).slice(2, 4).map((c) => ({ t: c.split(' — ')[0], m: phaseLabel + ' · Course', c: 'var(--violet)' }))).slice(0, 4) },
        { col: 'In progress', c: 'var(--blue)', cards: (phase?.courses || []).slice(0, 2).map((c) => ({ t: c.split(' — ')[0], m: phaseLabel, c: 'var(--blue)' })).concat((phase?.projects || []).slice(0, 1).map((p) => ({ t: p, m: phaseLabel + ' · Project', c: 'var(--amber)' }))) },
        { col: 'Done', c: 'var(--emerald)', cards: currentTasks.filter((t) => t.done).map((t) => ({ t: t.t, m: 'Completed today', c: 'var(--emerald)' })) },
      ]
    })() : [
      { col: 'To do', c: 'var(--subtle)', cards: [{ t: 'VNet peering notes', m: 'AZ-104 · 15 min', c: 'var(--blue)' }, { t: 'Practice set 4', m: 'AZ-104 · 25 min', c: 'var(--blue)' }, { t: 'Read: DR strategies', m: 'AZ-305 · 30 min', c: 'var(--violet)' }] },
      { col: 'In progress', c: 'var(--blue)', cards: [{ t: 'Configure NSG lab', m: 'AZ-104 · 30 min', c: 'var(--blue)' }, { t: 'Mock exam prep', m: 'AZ-104 · 60 min', c: 'var(--amber)' }] },
      { col: 'Done', c: 'var(--emerald)', cards: [{ t: 'Load Balancer video', m: 'Completed today', c: 'var(--emerald)' }, { t: 'Storage account lab', m: 'Completed yesterday', c: 'var(--emerald)' }, { t: 'AZ-900 exam', m: 'Passed 892/1000', c: 'var(--emerald)' }] },
    ]

    const scheduledMins = week.reduce((a, d) => a + d.items.length * 45, 0)
    const scheduledHrs = (scheduledMins / 60).toFixed(1)

    return e('div', { style: { display: 'flex', flexDirection: 'column', gap: 18 } },
      e('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 } },
        e('div', {}, e('div', { style: { fontSize: 24, fontWeight: 800, letterSpacing: '-.03em' } }, 'Planner'),
          e('div', { style: { fontSize: 14.5, color: 'var(--muted)', marginTop: 3 } }, monthStr + ' · ' + scheduledHrs + ' hrs scheduled this week')),
        e('div', { style: { display: 'flex', gap: 10, alignItems: 'center' } },
          e('div', { style: { display: 'flex', gap: 3, padding: 4, borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--border)' } },
            tabs.map((t, i) => e('button', { key: i, onClick: this.setPlannerView(t[0]), className: 'lf-btn', style: { padding: '7px 16px', borderRadius: 9, border: 'none', background: view === t[0] ? 'var(--surface)' : 'transparent', color: view === t[0] ? 'var(--text)' : 'var(--muted)', fontWeight: 600, fontSize: 13.5, cursor: 'pointer', boxShadow: view === t[0] ? 'var(--shadow-sm)' : 'none' } }, t[1]))),
          e('button', { className: 'lf-btn', onClick: this.go('mentor'), style: { padding: '9px 15px', borderRadius: 11, border: 'none', background: 'linear-gradient(135deg,var(--blue),var(--violet))', color: '#fff', fontWeight: 600, fontSize: 13.5, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 7 } },
            e('svg', { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: '#fff', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }, e('path', { d: 'M12 3v3M12 18v3M3 12h3M18 12h3' })), 'AI schedule'))),
      view === 'week' ? e('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 12 } },
        week.map((d, i) => e('div', { key: i, style: { borderRadius: 18, background: 'var(--surface)', border: '1px solid ' + (d.today ? 'var(--blue)' : 'var(--border)'), padding: 14, minHeight: 280, boxShadow: d.today ? 'var(--shadow)' : 'var(--shadow-sm)' } },
          e('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 14 } },
            e('span', { style: { fontSize: 12, fontWeight: 600, color: d.today ? 'var(--blue)' : 'var(--subtle)', textTransform: 'uppercase', letterSpacing: '.05em' } }, d.d),
            e('span', { style: { fontSize: 20, fontWeight: 800, color: d.today ? 'var(--blue)' : 'var(--text)', marginTop: 2 } }, d.n)),
          e('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
            d.items.length ? d.items.map((it, j) => e('div', { key: j, className: 'lf-btn', style: { padding: '9px 10px', borderRadius: 11, background: it.soft, borderLeft: '3px solid ' + it.c, cursor: 'grab' } },
              e('div', { style: { fontSize: 11, fontWeight: 700, color: it.c } }, it.time),
              e('div', { style: { fontSize: 12.5, fontWeight: 600, color: 'var(--text)', marginTop: 2, lineHeight: 1.3 } }, it.t)))
            : e('div', { style: { textAlign: 'center', padding: '20px 0', fontSize: 12, color: 'var(--subtle)', border: '1.5px dashed var(--border)', borderRadius: 11 } }, 'Rest day')))))
      : view === 'kanban' ? e('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 16 } },
        kb.map((k, i) => e('div', { key: i, style: { borderRadius: 18, background: 'var(--surface-2)', border: '1px solid var(--border)', padding: 16 } },
          e('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 } },
            e('span', { style: { width: 9, height: 9, borderRadius: 99, background: k.c } }),
            e('span', { style: { fontSize: 14, fontWeight: 700 } }, k.col),
            e('span', { style: { marginLeft: 'auto', fontSize: 12, fontWeight: 600, color: 'var(--subtle)', background: 'var(--surface)', borderRadius: 99, padding: '2px 9px' } }, k.cards.length)),
          e('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
            k.cards.map((c, j) => e('div', { key: j, className: 'lf-card-h', style: { padding: 14, borderRadius: 13, background: 'var(--surface)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', cursor: 'grab', borderLeft: '3px solid ' + c.c } },
              e('div', { style: { fontSize: 14, fontWeight: 600, marginBottom: 5 } }, c.t),
              e('div', { style: { fontSize: 12.5, color: 'var(--muted)' } }, c.m)))))))
      : this.monthView()
    )
  }
  monthView() {
    const dows = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    const cells = []; for (let i = 0; i < 35; i++) { const day = i - 2; cells.push(day >= 1 && day <= 28 ? day : null) }
    const events = { 5: 2, 6: 1, 12: 2, 13: 1, 14: 3, 16: 1, 17: 2, 18: 1, 20: 1, 21: 2, 24: 1, 25: 1, 27: 2, 28: 1 }
    return e('div', { style: { borderRadius: 20, background: 'var(--surface)', border: '1px solid var(--border)', padding: 22, boxShadow: 'var(--shadow-sm)' } },
      e('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 8, marginBottom: 10 } }, dows.map((d, i) => e('div', { key: i, style: { fontSize: 12, fontWeight: 700, color: 'var(--subtle)', textAlign: 'center' } }, d))),
      e('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 8 } }, cells.map((d, i) => e('div', { key: i, style: { minHeight: 84, borderRadius: 12, background: d === 14 ? 'var(--blue-soft)' : 'var(--surface-2)', border: '1px solid ' + (d === 14 ? 'var(--blue)' : 'var(--border)'), padding: 8, opacity: d ? 1 : .4 } },
        d ? e('div', {}, e('div', { style: { fontSize: 13, fontWeight: 700, color: d === 14 ? 'var(--blue)' : 'var(--text)' } }, d),
          e('div', { style: { display: 'flex', flexDirection: 'column', gap: 3, marginTop: 5 } }, Array.from({ length: events[d] || 0 }).map((_, j) => e('div', { key: j, style: { height: 4, borderRadius: 99, background: ['var(--blue)', 'var(--violet)', 'var(--amber)'][j % 3] } })))) : null))))
  }

  buildAnalytics() {
    const rm = this.state.roadmap
    const { streak, hoursStudied, dates = [] } = this.state.progress
    const emptyState = (label) => e('div', { style: { textAlign: 'center', padding: '80px 24px' } },
      e('div', { style: { fontSize: 48, marginBottom: 16 } }, '📊'),
      e('div', { style: { fontSize: 20, fontWeight: 700, marginBottom: 8 } }, 'No data yet'),
      e('div', { style: { fontSize: 14.5, color: 'var(--muted)', marginBottom: 24 } }, label),
      e('button', { className: 'lf-btn', onClick: this.go('onboarding'), style: { padding: '12px 22px', borderRadius: 12, border: 'none', background: 'linear-gradient(135deg,var(--blue),var(--violet))', color: '#fff', fontWeight: 600, fontSize: 14.5, cursor: 'pointer' } }, 'Build my roadmap'))
    if (!rm) return emptyState('Generate your roadmap to start tracking your learning analytics.')

    const phases = rm.phases || []
    const currentTasks = this.state.tasks || rm.todaysTasks || []
    const doneTasks = currentTasks.filter((t) => t.done).length
    const completionPct = currentTasks.length ? Math.round(doneTasks / currentTasks.length * 100) : 0
    const streakPct = Math.min(100, streak * 10)
    const hoursPct = Math.min(100, Math.round(hoursStudied * 5))
    const overallPct = Math.round(phases.reduce((a, p) => a + p.pct, 0) / Math.max(phases.length, 1))
    const rings = [
      ['Tasks today', completionPct, 'var(--blue)'],
      ['Streak', streakPct, 'var(--amber)'],
      ['Hours in', hoursPct, 'var(--violet)'],
      ['Overall', overallPct, 'var(--emerald)'],
    ]

    // Radar: use phase cert names and completion %
    const radarAxes = phases.slice(0, 6).map((p) => [p.cert || p.title, p.pct])
    while (radarAxes.length < 3) radarAxes.push(['Upcoming', 0])
    const cx = 140, cy = 130, R = 100
    const pt = (i, r) => { const a = (-90 + i * 360 / radarAxes.length) * Math.PI / 180; return [cx + r * Math.cos(a), cy + r * Math.sin(a)] }
    const dataPts = radarAxes.map((ax, i) => pt(i, R * ax[1] / 100)).map((p) => p.join(',')).join(' ')
    const grid = [0.25, 0.5, 0.75, 1].map((g) => radarAxes.map((_, i) => pt(i, R * g)).map((p) => p.join(',')).join(' '))

    // Heatmap: 18 weeks back from today
    const heatColors = ['var(--surface-3)', 'rgba(37,99,235,.28)', 'rgba(37,99,235,.55)', 'var(--blue)']
    const dayLabels = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
    const weeks = 18
    const today = new Date(); const dow = today.getDay()
    const startDate = new Date(today); startDate.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1) - (weeks - 1) * 7)
    const heatCells = []
    for (let w = 0; w < weeks; w++) {
      for (let d = 0; d < 7; d++) {
        const cell = new Date(startDate); cell.setDate(startDate.getDate() + w * 7 + d)
        const iso = cell.toISOString().slice(0, 10)
        heatCells.push(dates.includes(iso) ? 3 : 0)
      }
    }

    return e('div', { style: { display: 'flex', flexDirection: 'column', gap: 18 } },
      e('div', {}, e('div', { style: { fontSize: 24, fontWeight: 800, letterSpacing: '-.03em' } }, 'Progress Analytics'),
        e('div', { style: { fontSize: 14.5, color: 'var(--muted)', marginTop: 3 } }, rm.headline + ' · your real-time learning data')),
      e('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 16 } },
        rings.map((rg, i) => { const rr = this.ring(rg[0] === 'Streak' ? Math.min(streak, 10) * 10 : rg[1], 34); return e('div', { key: i, className: 'lf-card-h', style: { borderRadius: 20, background: 'var(--surface)', border: '1px solid var(--border)', padding: 20, boxShadow: 'var(--shadow-sm)', display: 'flex', alignItems: 'center', gap: 16 } },
          e('div', { style: { position: 'relative', width: 80, height: 80, flex: 'none' } },
            e('svg', { width: 80, height: 80, viewBox: '0 0 80 80', style: { transform: 'rotate(-90deg)' } },
              e('circle', { cx: 40, cy: 40, r: 34, fill: 'none', stroke: 'var(--surface-3)', strokeWidth: 8 }),
              e('circle', { cx: 40, cy: 40, r: 34, fill: 'none', stroke: rg[2], strokeWidth: 8, strokeLinecap: 'round', strokeDasharray: rr.c, strokeDashoffset: rr.off })),
            e('div', { style: { position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 800 } },
              rg[0] === 'Streak' ? streak + 'd' : rg[0] === 'Hours in' ? parseFloat(hoursStudied.toFixed(1)) + 'h' : rg[1] + '%')),
          e('div', {}, e('div', { style: { fontSize: 14, fontWeight: 600 } }, rg[0]),
            e('div', { style: { fontSize: 12.5, color: 'var(--muted)', fontWeight: 500, marginTop: 3 } },
              rg[0] === 'Tasks today' ? doneTasks + ' of ' + currentTasks.length + ' done'
              : rg[0] === 'Streak' ? (streak > 0 ? 'Keep it up! 🔥' : 'Start today')
              : rg[0] === 'Hours in' ? 'Total invested'
              : overallPct + '% of roadmap'))) })),
      e('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 16 } },
        e('div', { style: { borderRadius: 20, background: 'var(--surface)', border: '1px solid var(--border)', padding: 22, boxShadow: 'var(--shadow-sm)' } },
          e('div', { style: { fontSize: 16, fontWeight: 700, marginBottom: 4 } }, 'Phase Progress Radar'),
          e('div', { style: { fontSize: 13, color: 'var(--muted)', marginBottom: 6 } }, 'Completion across your learning phases'),
          e('div', { style: { display: 'flex', justifyContent: 'center' } },
            e('svg', { width: 280, height: 270, viewBox: '0 0 280 260' },
              grid.map((g, i) => e('polygon', { key: i, points: g, fill: 'none', stroke: 'var(--grid)', strokeWidth: 1 })),
              radarAxes.map((_, i) => { const p = pt(i, R); return e('line', { key: i, x1: cx, y1: cy, x2: p[0], y2: p[1], stroke: 'var(--grid)', strokeWidth: 1 }) }),
              e('polygon', { points: dataPts, fill: 'rgba(37,99,235,.18)', stroke: 'var(--blue)', strokeWidth: 2, strokeLinejoin: 'round' }),
              radarAxes.map((ax, i) => { const p = pt(i, R * ax[1] / 100); return e('circle', { key: i, cx: p[0], cy: p[1], r: 3.5, fill: 'var(--blue)' }) }),
              radarAxes.map((ax, i) => { const p = pt(i, R + 22); return e('text', { key: i, x: p[0], y: p[1], fontSize: 11, fontWeight: 600, fill: 'var(--muted)', textAnchor: 'middle', dominantBaseline: 'middle' }, ax[0]) })))),
        e('div', { style: { borderRadius: 20, background: 'var(--surface)', border: '1px solid var(--border)', padding: 22, boxShadow: 'var(--shadow-sm)' } },
          e('div', { style: { fontSize: 16, fontWeight: 700, marginBottom: 4 } }, 'Phase Breakdown'),
          e('div', { style: { fontSize: 13, color: 'var(--muted)', marginBottom: 16 } }, 'Progress per phase'),
          e('div', { style: { display: 'flex', flexDirection: 'column', gap: 14 } },
            phases.map((p, i) => {
              const c = LearnFlow.PHASE_COLORS[i % LearnFlow.PHASE_COLORS.length]
              return e('div', { key: i },
                e('div', { style: { display: 'flex', justifyContent: 'space-between', marginBottom: 6 } },
                  e('span', { style: { fontSize: 13.5, fontWeight: 600 } }, p.title),
                  e('span', { style: { fontSize: 13, color: 'var(--muted)' } }, p.pct + '%')),
                e('div', { style: { height: 7, borderRadius: 99, background: 'var(--surface-3)', overflow: 'hidden' } },
                  e('div', { style: { height: '100%', width: p.pct + '%', borderRadius: 99, background: c.color, transition: 'width .5s' } })))
            })))),
      e('div', { style: { borderRadius: 20, background: 'var(--surface)', border: '1px solid var(--border)', padding: 22, boxShadow: 'var(--shadow-sm)' } },
        e('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18, flexWrap: 'wrap', gap: 8 } },
          e('div', {}, e('div', { style: { fontSize: 16, fontWeight: 700 } }, 'Study Consistency'),
            e('div', { style: { fontSize: 13, color: 'var(--muted)', marginTop: 2 } }, 'Days you completed at least one task')),
          e('div', { style: { display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: 'var(--subtle)' } }, 'None', heatColors.map((c, i) => e('span', { key: i, style: { width: 13, height: 13, borderRadius: 4, background: c } })), 'Active')),
        e('div', { style: { display: 'flex', gap: 8 } },
          e('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } }, dayLabels.map((d, i) => e('span', { key: i, style: { height: 15, fontSize: 10, color: 'var(--subtle)', display: 'flex', alignItems: 'center' } }, d))),
          e('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(' + weeks + ',1fr)', gridAutoFlow: 'column', gridTemplateRows: 'repeat(7,15px)', gap: 4, flex: 1 } },
            heatCells.map((lvl, i) => e('div', { key: i, style: { borderRadius: 4, background: heatColors[lvl] } })))))
    )
  }

  buildSkillTree() {
    const rm = this.state.roadmap
    const emptyState = () => e('div', { style: { textAlign: 'center', padding: '80px 24px' } },
      e('div', { style: { fontSize: 48, marginBottom: 16 } }, '🌳'),
      e('div', { style: { fontSize: 20, fontWeight: 700, marginBottom: 8 } }, 'No skill tree yet'),
      e('div', { style: { fontSize: 14.5, color: 'var(--muted)', marginBottom: 24 } }, 'Your skill tree is generated from your learning roadmap.'),
      e('button', { className: 'lf-btn', onClick: this.go('onboarding'), style: { padding: '12px 22px', borderRadius: 12, border: 'none', background: 'linear-gradient(135deg,var(--blue),var(--violet))', color: '#fff', fontWeight: 600, fontSize: 14.5, cursor: 'pointer' } }, 'Build my roadmap'))
    if (!rm) return emptyState()

    const phases = rm.phases || []
    const W = Math.max(900, phases.length * 220)
    const H = 500
    const sty = { learned: { bg: 'var(--emerald)', ring: 'var(--emerald)', fg: '#fff' }, inprogress: { bg: 'var(--surface)', ring: 'var(--blue)', fg: 'var(--blue-ink)' }, locked: { bg: 'var(--surface-2)', ring: 'var(--border-strong)', fg: 'var(--subtle)' } }

    // Phase nodes evenly spaced at the top
    const padding = 100
    const phaseNodes = phases.map((p, i) => {
      const status = p.pct === 100 ? 'learned' : p.status === 'In progress' ? 'inprogress' : 'locked'
      const c = LearnFlow.PHASE_COLORS[i % LearnFlow.PHASE_COLORS.length]
      return { id: 'p' + i, x: Math.round(padding + (i * (W - 2 * padding)) / Math.max(phases.length - 1, 1)), y: 90, label: p.title, sub: p.cert, status, color: c.color, soft: c.soft, pct: p.pct }
    })

    // Skill nodes below each phase
    const skillNodes = []; const edges = []
    phases.forEach((p, pi) => {
      const px = phaseNodes[pi].x
      const skills = (p.skills || []).slice(0, 4)
      skills.forEach((skill, si) => {
        const col = si % 2; const row = Math.floor(si / 2)
        const x = px + (col === 0 ? -55 : 55)
        const y = 220 + row * 100
        const status = p.pct === 100 ? 'learned' : (p.status === 'In progress' && si < 2) ? 'inprogress' : p.status === 'In progress' ? 'locked' : 'locked'
        const id = 'p' + pi + 's' + si
        skillNodes.push({ id, x, y, label: skill, status })
        edges.push([phaseNodes[pi], { x, y, status }])
      })
      if (pi > 0) edges.push([phaseNodes[pi - 1], phaseNodes[pi]])
    })

    const learned = [...phaseNodes, ...skillNodes].filter((n) => n.status === 'learned').length
    const inprog = [...phaseNodes, ...skillNodes].filter((n) => n.status === 'inprogress').length
    const locked = [...phaseNodes, ...skillNodes].filter((n) => n.status === 'locked').length
    const nextPhase = phases.find((p) => p.status !== 'Completed' && p.pct < 100)

    const renderNode = (n, big) => {
      const st = sty[n.status]
      return e('div', { key: n.id, style: { position: 'absolute', left: n.x, top: n.y, transform: 'translate(-50%,-50%)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, cursor: n.status !== 'locked' ? 'pointer' : 'default', zIndex: 2 } },
        e('div', { className: n.status !== 'locked' ? 'lf-btn' : '', style: { width: big ? 64 : 48, height: big ? 64 : 48, borderRadius: big ? 18 : 13, background: st.bg, border: '2.5px solid ' + st.ring, boxShadow: n.status === 'inprogress' ? '0 0 0 6px ' + (n.soft || 'var(--blue-soft)') : n.status === 'learned' ? 'var(--shadow-sm)' : 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' } },
          n.status === 'learned' ? e('svg', { width: big ? 26 : 20, height: big ? 26 : 20, viewBox: '0 0 24 24', fill: 'none', stroke: '#fff', strokeWidth: 2.8, strokeLinecap: 'round', strokeLinejoin: 'round' }, e('path', { d: 'M20 6 9 17l-5-5' }))
          : n.status === 'inprogress' ? e('div', { style: { fontSize: big ? 18 : 14, fontWeight: 800, color: st.fg } }, '⋯')
          : e('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'var(--subtle)', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }, e('path', { d: 'M6 11V8a6 6 0 0 1 12 0v3' }), e('rect', { x: 5, y: 11, width: 14, height: 9, rx: 2 }))),
        e('div', { style: { textAlign: 'center', maxWidth: big ? 110 : 84 } },
          e('div', { style: { fontSize: big ? 13 : 11.5, fontWeight: 600, color: n.status === 'locked' ? 'var(--subtle)' : 'var(--text)', lineHeight: 1.25 } }, n.label),
          n.sub ? e('div', { style: { fontSize: 10.5, fontWeight: 700, color: n.status === 'learned' ? 'var(--emerald)' : n.status === 'inprogress' ? 'var(--blue)' : 'var(--subtle)', marginTop: 2 } }, n.sub) : null))
    }

    return e('div', { style: { display: 'flex', flexDirection: 'column', gap: 18 } },
      e('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 } },
        e('div', {}, e('div', { style: { fontSize: 24, fontWeight: 800, letterSpacing: '-.03em' } }, 'Skill Tree'),
          e('div', { style: { fontSize: 14.5, color: 'var(--muted)', marginTop: 3 } }, rm.headline + ' · unlock skills as you progress')),
        e('div', { style: { display: 'flex', gap: 18 } },
          [['var(--emerald)', 'Mastered · ' + learned], ['var(--blue)', 'In progress · ' + inprog], ['var(--subtle)', 'Locked · ' + locked]].map((l, i) =>
            e('div', { key: i, style: { display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, color: 'var(--muted)', fontWeight: 500 } }, e('span', { style: { width: 10, height: 10, borderRadius: 99, background: l[0] } }), l[1])))),
      e('div', { className: 'lf-scroll', style: { borderRadius: 22, background: 'var(--surface)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', padding: 20, overflowX: 'auto' } },
        e('div', { style: { position: 'relative', width: W, height: H, margin: '0 auto' } },
          e('svg', { width: W, height: H, style: { position: 'absolute', inset: 0 } },
            edges.map((ed, i) => {
              const [a, b] = ed; const dim = b.status === 'locked'
              return e('path', { key: i, d: 'M' + a.x + ' ' + a.y + ' C' + ((a.x + b.x) / 2) + ' ' + a.y + ',' + ((a.x + b.x) / 2) + ' ' + b.y + ',' + b.x + ' ' + b.y, fill: 'none', stroke: dim ? 'var(--border)' : 'var(--blue)', strokeWidth: 2, strokeDasharray: dim ? '5 6' : 'none', opacity: dim ? .5 : .4 })
            })),
          phaseNodes.map((n) => renderNode(n, true)),
          skillNodes.map((n) => renderNode(n, false)))),
      nextPhase && e('div', { style: { display: 'flex', gap: 14, padding: '16px 20px', borderRadius: 16, background: 'var(--blue-soft)', border: '1px solid var(--border)', alignItems: 'center' } },
        e('div', { style: { width: 34, height: 34, borderRadius: 10, background: 'linear-gradient(135deg,var(--blue),var(--violet))', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' } },
          e('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: '#fff', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }, e('path', { d: 'M12 3v3M12 18v3M3 12h3M18 12h3' }))),
        e('div', { style: { flex: 1, fontSize: 14, color: 'var(--text)' } },
          e('b', {}, 'Next up: ' + nextPhase.title + ' · ' + nextPhase.cert + '.'), ' ' + nextPhase.sub),
        e('button', { className: 'lf-btn', onClick: this.go('mentor'), style: { padding: '9px 15px', borderRadius: 10, border: 'none', background: 'var(--blue)', color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer' } }, 'Ask Mentor how'))
    )
  }

  buildLibrary() {
    const rm = this.state.roadmap
    const filt = this.state.libraryFilter
    if (!rm) return e('div', { style: { textAlign: 'center', padding: '80px 24px' } },
      e('div', { style: { fontSize: 48, marginBottom: 16 } }, '📚'),
      e('div', { style: { fontSize: 20, fontWeight: 700, marginBottom: 8 } }, 'No resources yet'),
      e('div', { style: { fontSize: 14.5, color: 'var(--muted)', marginBottom: 24 } }, 'Your library is populated with courses and resources from your roadmap.'),
      e('button', { className: 'lf-btn', onClick: this.go('onboarding'), style: { padding: '12px 22px', borderRadius: 12, border: 'none', background: 'linear-gradient(135deg,var(--blue),var(--violet))', color: '#fff', fontWeight: 600, fontSize: 14.5, cursor: 'pointer' } }, 'Build my roadmap'))

    // Build items from roadmap phases
    const allItems = []
    ;(rm.phases || []).forEach((p, pi) => {
      const c = LearnFlow.PHASE_COLORS[pi % LearnFlow.PHASE_COLORS.length]
      ;(p.courses || []).forEach((course) => {
        const parts = course.split(' — ')
        allItems.push({ t: parts[0], type: 'Course', src: parts[1] || 'Online', meta: p.title + ' · ' + p.cert, tags: [p.cert, ...(p.skills || []).slice(0, 2)], c: c.color, pct: p.pct === 100 ? 100 : p.status === 'In progress' ? Math.min(Math.round(p.pct * 0.9), 95) : 0 })
      })
      ;(p.projects || []).forEach((proj) => {
        allItems.push({ t: proj, type: 'Project', src: 'Hands-on · ' + p.title, meta: p.assessment || p.cert, tags: [p.cert, 'Project'], c: c.color, pct: p.pct === 100 ? 100 : 0 })
      })
    })
    const filters = ['All', 'Course', 'Project']
    const shown = filt === 'All' ? allItems : allItems.filter((i) => i.type === filt)
    const typeIcon = { Course: 'M6 4h10v16H8a2 2 0 0 0-2 2zM6 4v18', Project: 'M3 7h18M3 7l2 13h14l2-13M9 11v5M15 11v5' }

    return e('div', { style: { display: 'flex', flexDirection: 'column', gap: 18 } },
      e('div', {},
        e('div', { style: { fontSize: 24, fontWeight: 800, letterSpacing: '-.03em' } }, 'Resource Library'),
        e('div', { style: { fontSize: 14.5, color: 'var(--muted)', marginTop: 3 } }, rm.headline + ' · ' + allItems.length + ' resources across ' + (rm.phases || []).length + ' phases')),
      e('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
        filters.map((f, i) => e('button', { key: i, onClick: this.setLibraryFilter(f), className: 'lf-btn', style: { padding: '8px 14px', borderRadius: 99, border: '1px solid ' + (filt === f ? 'transparent' : 'var(--border)'), background: filt === f ? 'var(--text)' : 'var(--surface)', color: filt === f ? 'var(--bg)' : 'var(--muted)', fontWeight: 600, fontSize: 13, cursor: 'pointer' } }, f))),
      e('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))', gap: 16 } },
        shown.map((it, i) => e('div', { key: i, className: 'lf-card-h', style: { borderRadius: 18, background: 'var(--surface)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', overflow: 'hidden', cursor: 'pointer' } },
          e('div', { style: { height: 88, background: it.c, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: .92 } },
            e('svg', { width: 32, height: 32, viewBox: '0 0 24 24', fill: 'none', stroke: '#fff', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', style: { opacity: .9 } }, e('path', { d: typeIcon[it.type] || typeIcon.Course })),
            it.pct === 100 ? e('span', { style: { position: 'absolute', top: 8, right: 10, fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 99, background: 'rgba(255,255,255,.92)', color: it.c } }, '✓ Done') : null),
          e('div', { style: { padding: 16 } },
            e('div', { style: { fontSize: 11, fontWeight: 700, color: 'var(--subtle)', letterSpacing: '.05em', textTransform: 'uppercase', marginBottom: 5 } }, it.src),
            e('div', { style: { fontSize: 14.5, fontWeight: 700, lineHeight: 1.3, marginBottom: 6 } }, it.t),
            e('div', { style: { fontSize: 12.5, color: 'var(--muted)', marginBottom: 10 } }, it.meta),
            e('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: it.pct > 0 && it.pct < 100 ? 10 : 0 } },
              it.tags.filter(Boolean).map((tg, j) => e('span', { key: j, style: { fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 7, background: 'var(--surface-2)', color: 'var(--muted)' } }, tg))),
            it.pct > 0 && it.pct < 100 ? e('div', { style: { height: 5, borderRadius: 99, background: 'var(--surface-3)', overflow: 'hidden' } }, e('div', { style: { height: '100%', width: it.pct + '%', borderRadius: 99, background: it.c } })) : null))))
    )
  }

  buildGoals() {
    const rm = this.state.roadmap
    const { streak, hoursStudied } = this.state.progress
    if (!rm) return e('div', { style: { textAlign: 'center', padding: '80px 24px' } },
      e('div', { style: { fontSize: 48, marginBottom: 16 } }, '🎯'),
      e('div', { style: { fontSize: 20, fontWeight: 700, marginBottom: 8 } }, 'No goals yet'),
      e('div', { style: { fontSize: 14.5, color: 'var(--muted)', marginBottom: 24 } }, 'Your goals and milestones are generated from your roadmap.'),
      e('button', { className: 'lf-btn', onClick: this.go('onboarding'), style: { padding: '12px 22px', borderRadius: 12, border: 'none', background: 'linear-gradient(135deg,var(--blue),var(--violet))', color: '#fff', fontWeight: 600, fontSize: 14.5, cursor: 'pointer' } }, 'Build my roadmap'))

    const phases = rm.phases || []
    const milestones = rm.milestones || []
    const palette = LearnFlow.PHASE_COLORS

    // Goals from milestones + overall goal
    const goals = [
      { t: rm.headline, sub: 'Overall goal · ' + rm.totalWeeks + ' weeks · target ' + rm.targetDate, pct: Math.round(phases.reduce((a, p) => a + p.pct, 0) / Math.max(phases.length, 1)), c: 'var(--blue)', soft: 'var(--blue-soft)', due: rm.targetDate, status: 'In progress' },
      ...milestones.slice(0, 2).map((m, i) => {
        const c = palette[(i + 1) % palette.length]
        return { t: m.t, sub: m.d, pct: i === 0 ? (phases[0]?.pct || 0) : 0, c: c.color, soft: c.soft, due: m.d, status: i === 0 ? (phases[0]?.status || 'Upcoming') : 'Upcoming' }
      }),
    ]

    // Achievements based on real progress
    const achievements = [
      { t: 'Roadmap created', c: 'var(--blue)', icon: 'M9 4 4 6v14l5-2 6 2 5-2V4l-5 2-6-2zM9 4v14M15 6v14', done: true },
      { t: '7-day streak', c: 'var(--amber)', icon: 'M12 2c1 3 4 4 4 8a4 4 0 0 1-8 0c0-1 .5-2 1-2.5C9 9 12 8 12 2z', done: streak >= 7 },
      { t: '30-day streak', c: 'var(--amber)', icon: 'M12 2c1 3 4 4 4 8a4 4 0 0 1-8 0c0-1 .5-2 1-2.5C9 9 12 8 12 2z', done: streak >= 30 },
      { t: '10 hours studied', c: 'var(--violet)', icon: 'M12 6v6l4 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', done: hoursStudied >= 10 },
      { t: 'Phase 1 complete', c: 'var(--emerald)', icon: 'M20 6 9 17l-5-5', done: phases[0]?.pct === 100 },
      { t: 'Goal reached', c: 'var(--emerald)', icon: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z', done: phases.every((p) => p.pct === 100) },
    ]

    // Timeline from milestones
    const timeline = milestones.map((m, i) => ({ t: m.t, d: m.d, c: palette[i % palette.length].color, future: i > 0 && (phases[0]?.pct || 0) < 50 }))

    return e('div', { style: { display: 'flex', flexDirection: 'column', gap: 18 } },
      e('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 } },
        e('div', {}, e('div', { style: { fontSize: 24, fontWeight: 800, letterSpacing: '-.03em' } }, 'Goals & Milestones'),
          e('div', { style: { fontSize: 14.5, color: 'var(--muted)', marginTop: 3 } }, achievements.filter((a) => a.done).length + ' achievements unlocked · ' + milestones.length + ' milestones')),
        e('button', { className: 'lf-btn', onClick: this.go('roadmap'), style: { padding: '10px 16px', borderRadius: 11, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontWeight: 600, fontSize: 13.5, cursor: 'pointer' } }, 'View roadmap')),
      e('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 16 } },
        goals.map((g, i) => { const rr = this.ring(g.pct, 26); return e('div', { key: i, className: 'lf-card-h', style: { borderRadius: 20, background: 'var(--surface)', border: '1px solid var(--border)', padding: 22, boxShadow: 'var(--shadow-sm)' } },
          e('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 } },
            e('span', { style: { fontSize: 12, fontWeight: 700, padding: '4px 10px', borderRadius: 99, background: g.soft, color: g.c } }, g.status),
            e('div', { style: { position: 'relative', width: 64, height: 64 } },
              e('svg', { width: 64, height: 64, viewBox: '0 0 64 64', style: { transform: 'rotate(-90deg)' } },
                e('circle', { cx: 32, cy: 32, r: 26, fill: 'none', stroke: 'var(--surface-3)', strokeWidth: 7 }),
                e('circle', { cx: 32, cy: 32, r: 26, fill: 'none', stroke: g.c, strokeWidth: 7, strokeLinecap: 'round', strokeDasharray: rr.c, strokeDashoffset: rr.off })),
              e('div', { style: { position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 800 } }, g.pct + '%'))),
          e('div', { style: { fontSize: 16, fontWeight: 700, lineHeight: 1.3, marginBottom: 5 } }, g.t),
          e('div', { style: { fontSize: 13.5, color: 'var(--muted)', marginBottom: 14 } }, g.sub),
          e('div', { style: { display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, color: 'var(--muted)', fontWeight: 500 } },
            e('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }, e('path', { d: 'M12 6v6l4 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z' })), g.due)) })),
      e('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 } },
        e('div', { style: { borderRadius: 20, background: 'var(--surface)', border: '1px solid var(--border)', padding: 22, boxShadow: 'var(--shadow-sm)' } },
          e('div', { style: { fontSize: 16, fontWeight: 700, marginBottom: 18 } }, 'Milestone Timeline'),
          e('div', { style: { display: 'flex', flexDirection: 'column' } },
            timeline.map((m, i, arr) => e('div', { key: i, style: { display: 'flex', gap: 14, paddingBottom: i < arr.length - 1 ? 16 : 0 } },
              e('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center' } },
                e('div', { style: { width: 14, height: 14, borderRadius: 99, background: m.future ? 'var(--surface)' : m.c, border: m.future ? '2px dashed var(--border-strong)' : 'none', flex: 'none' } }),
                i < arr.length - 1 ? e('div', { style: { width: 2, flex: 1, minHeight: 20, background: 'var(--border)' } }) : null),
              e('div', { style: { flex: 1 } },
                e('div', { style: { fontSize: 14.5, fontWeight: 600, color: m.future ? 'var(--muted)' : 'var(--text)' } }, m.t),
                e('div', { style: { fontSize: 12.5, color: 'var(--subtle)', marginTop: 1 } }, m.d)))))),
        e('div', { style: { borderRadius: 20, background: 'var(--surface)', border: '1px solid var(--border)', padding: 22, boxShadow: 'var(--shadow-sm)' } },
          e('div', { style: { fontSize: 16, fontWeight: 700, marginBottom: 18 } }, 'Achievements'),
          e('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 } },
            achievements.map((a, i) => e('div', { key: i, style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, opacity: a.done ? 1 : .45 } },
              e('div', { style: { width: 54, height: 54, borderRadius: 16, background: a.done ? a.c : 'var(--surface-2)', border: a.done ? 'none' : '2px dashed var(--border-strong)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: a.done ? 'var(--shadow-sm)' : 'none' } },
                e('svg', { width: 26, height: 26, viewBox: '0 0 24 24', fill: 'none', stroke: a.done ? '#fff' : 'var(--subtle)', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round' }, e('path', { d: a.icon }))),
              e('div', { style: { textAlign: 'center' } },
                e('div', { style: { fontSize: 12, fontWeight: 600, lineHeight: 1.2 } }, a.t),
                e('div', { style: { fontSize: 11, color: a.done ? 'var(--emerald)' : 'var(--subtle)', marginTop: 2, fontWeight: 600 } }, a.done ? '✓ Unlocked' : 'Locked')))))))
    )
  }

  buildSettings() {
    const dark = this.state.theme === 'dark'
    const rm = this.state.roadmap
    const displayName = this.state.userName || 'Alex Carter'
    const initials = this.getInitials(this.state.userName)
    const toggle = (on, onClick) => e('div', { onClick, className: 'lf-btn', style: { width: 46, height: 27, borderRadius: 99, background: on ? 'var(--blue)' : 'var(--surface-3)', padding: 3, cursor: 'pointer', flex: 'none', transition: 'background .25s' } },
      e('div', { style: { width: 21, height: 21, borderRadius: 99, background: '#fff', boxShadow: 'var(--shadow-sm)', transform: on ? 'translateX(19px)' : 'none', transition: 'transform .25s' } }))
    const row = (t, sub, control) => e('div', { style: { display: 'flex', alignItems: 'center', gap: 14, padding: '15px 0', borderBottom: '1px solid var(--border)' } },
      e('div', { style: { flex: 1 } }, e('div', { style: { fontSize: 14.5, fontWeight: 600 } }, t), sub ? e('div', { style: { fontSize: 13, color: 'var(--muted)', marginTop: 2 } }, sub) : null), control)
    const card = (title, ...kids) => e('div', { style: { borderRadius: 20, background: 'var(--surface)', border: '1px solid var(--border)', padding: '8px 24px 16px', boxShadow: 'var(--shadow-sm)' } },
      e('div', { style: { fontSize: 15, fontWeight: 700, padding: '16px 0 4px' } }, title), ...kids)
    return e('div', { style: { display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 760 } },
      e('div', {}, e('div', { style: { fontSize: 24, fontWeight: 800, letterSpacing: '-.03em' } }, 'Settings'),
        e('div', { style: { fontSize: 14.5, color: 'var(--muted)', marginTop: 3 } }, 'Manage your profile, preferences and account')),

      // Profile card — editable name
      e('div', { style: { borderRadius: 20, background: 'var(--surface)', border: '1px solid var(--border)', padding: 24, boxShadow: 'var(--shadow-sm)', display: 'flex', alignItems: 'center', gap: 18 } },
        e('div', { style: { width: 64, height: 64, borderRadius: 99, background: 'linear-gradient(135deg,var(--emerald),var(--blue))', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 24, flex: 'none' } }, initials),
        e('div', { style: { flex: 1 } },
          e('input', { value: this.state.userName, onChange: (ev) => this.setState({ userName: ev.target.value }), placeholder: 'Your name', style: { fontSize: 18, fontWeight: 700, border: 'none', background: 'transparent', color: 'var(--text)', outline: 'none', width: '100%', fontFamily: 'inherit', borderBottom: '1.5px dashed var(--border-strong)', paddingBottom: 2, marginBottom: 6 } }),
          e('div', { style: { fontSize: 14, color: 'var(--muted)' } }, this.state.user ? this.state.user.email : 'Not signed in'),
          e('div', { style: { display: 'flex', gap: 8, marginTop: 10 } },
            [rm ? ('🎯 ' + rm.headline) : '🎯 No roadmap yet', '🔥 ' + (this.state.progress.streak || 0) + '-day streak'].map((b, i) => e('span', { key: i, style: { fontSize: 12, fontWeight: 600, padding: '4px 10px', borderRadius: 99, background: 'var(--surface-2)', color: 'var(--muted)' } }, b))))),
      // Learning path card
      e('div', { style: { borderRadius: 20, background: 'var(--surface)', border: '1px solid var(--border)', padding: 24, boxShadow: 'var(--shadow-sm)' } },
        e('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 } },
          e('div', { style: { fontSize: 15, fontWeight: 700 } }, 'Learning Path'),
          rm && e('span', { style: { fontSize: 12, fontWeight: 700, padding: '4px 10px', borderRadius: 99, background: 'var(--emerald-soft)', color: 'var(--emerald)' } }, 'Active')),
        rm ? e('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
          e('div', { style: { fontSize: 16, fontWeight: 700 } }, rm.headline),
          e('div', { style: { display: 'flex', gap: 20, flexWrap: 'wrap', fontSize: 14, color: 'var(--muted)' } },
            e('span', {}, '📅 ' + rm.totalWeeks + ' weeks total'),
            e('span', {}, '⏱ ' + rm.hoursPerDay + '/day'),
            e('span', {}, '🎯 Target: ' + rm.targetDate)),
          e('div', { style: { height: 6, borderRadius: 99, background: 'var(--surface-3)', marginTop: 4, overflow: 'hidden' } },
            e('div', { style: { height: '100%', width: '4%', borderRadius: 99, background: 'linear-gradient(90deg,var(--blue),var(--violet))' } })),
          e('div', { style: { marginTop: 14 } },
            e('button', { className: 'lf-btn', onClick: () => this.resetRoadmap(), style: { padding: '10px 16px', borderRadius: 11, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text)', fontWeight: 600, fontSize: 13.5, cursor: 'pointer' } }, 'Change learning path'))
        ) : e('div', { style: { display: 'flex', alignItems: 'center', gap: 14 } },
          e('div', { style: { flex: 1, fontSize: 14, color: 'var(--muted)' } }, 'No roadmap yet. Complete onboarding to generate your personalized learning path.'),
          e('button', { className: 'lf-btn', onClick: () => this.go('onboarding')(), style: { padding: '10px 16px', borderRadius: 11, border: 'none', background: 'linear-gradient(135deg,var(--blue),var(--violet))', color: '#fff', fontWeight: 600, fontSize: 13.5, cursor: 'pointer', whiteSpace: 'nowrap' } }, 'Build my roadmap'))),

      card('Appearance',
        row('Dark mode', 'Switch between light and dark themes', toggle(dark, () => this.toggleTheme())),
        row('Reduce motion', 'Minimize animations and transitions', toggle(this.state.settings.reduceMotion, () => this.setSetting('reduceMotion', !this.state.settings.reduceMotion))),
        e('div', { style: { padding: '15px 0 4px' } }, e('div', { style: { fontSize: 14.5, fontWeight: 600, marginBottom: 12 } }, 'Accent color'),
          e('div', { style: { display: 'flex', gap: 12 } }, ['var(--blue)', 'var(--violet)', 'var(--emerald)', 'var(--amber)'].map((c, i) => e('div', { key: i, className: 'lf-btn', style: { width: 34, height: 34, borderRadius: 11, background: c, cursor: 'pointer', border: i === 0 ? '2.5px solid var(--text)' : '2.5px solid transparent', boxShadow: 'var(--shadow-sm)' } }))))),
      card('Notifications',
        row('Daily study reminder', 'Get nudged at your scheduled study time', toggle(this.state.settings.dailyReminder, () => this.setSetting('dailyReminder', !this.state.settings.dailyReminder))),
        row('Streak alerts', 'Warn me before I break my streak', toggle(this.state.settings.streakAlerts, () => this.setSetting('streakAlerts', !this.state.settings.streakAlerts))),
        row('Weekly AI review', 'Sunday executive summary from Mentor AI', toggle(this.state.settings.weeklyReview, () => this.setSetting('weeklyReview', !this.state.settings.weeklyReview))),
        row('Milestone celebrations', 'Celebrate when you hit a goal', toggle(this.state.settings.celebrateMilestones, () => this.setSetting('celebrateMilestones', !this.state.settings.celebrateMilestones)))),
      card('Mentor AI',
        row('Grounded answers', 'Always cite my roadmap and verified sources', toggle(this.state.settings.groundedAnswers, () => this.setSetting('groundedAnswers', !this.state.settings.groundedAnswers))),
        row('Proactive coaching', 'Let Mentor AI suggest schedule changes', toggle(this.state.settings.proactiveCoaching, () => this.setSetting('proactiveCoaching', !this.state.settings.proactiveCoaching))),
        row('Auto-scheduling', 'Allow AI to book study sessions for me', toggle(this.state.settings.autoSchedule, () => this.setSetting('autoSchedule', !this.state.settings.autoSchedule)))),
      e('div', { style: { borderRadius: 20, background: 'var(--surface)', border: '1px solid var(--border)', padding: '8px 24px 20px', boxShadow: 'var(--shadow-sm)' } },
        e('div', { style: { fontSize: 15, fontWeight: 700, padding: '16px 0 8px' } }, 'Account'),
        e('div', { style: { display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 8 } },
          e('button', { className: 'lf-btn', style: { padding: '10px 16px', borderRadius: 11, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontWeight: 600, fontSize: 13.5, cursor: 'pointer' } }, 'Export my data'),
          e('button', { className: 'lf-btn', style: { padding: '10px 16px', borderRadius: 11, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontWeight: 600, fontSize: 13.5, cursor: 'pointer' } }, 'Manage subscription'),
          e('button', { className: 'lf-btn', onClick: () => this.doSignOut(), style: { padding: '10px 16px', borderRadius: 11, border: '1px solid var(--border)', background: 'var(--surface)', color: '#EF4444', fontWeight: 600, fontSize: 13.5, cursor: 'pointer' } }, this.state.user ? 'Sign out' : 'Reset & start over')))
    )
  }

  phone(label, content, activeNav) {
    const navs = [['Home', 'M4 11l8-7 8 7M6 10v9h12v-9'], ['Roadmaps', 'M9 4 4 6v14l5-2 6 2 5-2V4l-5 2-6-2zM9 4v14M15 6v14'], ['Planner', 'M4 7h16v13H4zM4 11h16M8 4v4M16 4v4'], ['Mentor', 'M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1'], ['Profile', 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM5 20a7 7 0 0 1 14 0']]
    return e('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 } },
      e('span', { style: { fontSize: 13, fontWeight: 600, color: 'var(--muted)' } }, label),
      e('div', { style: { width: 300, height: 620, borderRadius: 42, background: 'var(--text)', padding: 10, boxShadow: 'var(--shadow-lg)', flex: 'none' } },
        e('div', { style: { width: '100%', height: '100%', borderRadius: 33, background: 'var(--bg)', overflow: 'hidden', position: 'relative', display: 'flex', flexDirection: 'column' } },
          e('div', { style: { height: 44, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 22px', fontSize: 13, fontWeight: 700, color: 'var(--text)' } },
            e('span', {}, '9:41'),
            e('div', { style: { display: 'flex', gap: 5, alignItems: 'center' } }, e('span', { style: { width: 16, height: 9, borderRadius: 2, border: '1.5px solid var(--text)', display: 'inline-block' } }))),
          e('div', { className: 'lf-scroll', style: { flex: 1, overflowY: 'auto', padding: '4px 16px 16px' } }, content),
          e('div', { style: { height: 64, flex: 'none', borderTop: '1px solid var(--border)', background: 'var(--surface)', display: 'flex', alignItems: 'center', justifyContent: 'space-around', padding: '0 8px' } },
            navs.map((n, i) => e('div', { key: i, style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, color: i === activeNav ? 'var(--blue)' : 'var(--subtle)' } },
              e('svg', { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: i === activeNav ? 2.3 : 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' }, e('path', { d: n[1] })),
              e('span', { style: { fontSize: 9.5, fontWeight: i === activeNav ? 700 : 500 } }, n[0])))))))
  }
  buildMobile() {
    const home = e('div', { style: { display: 'flex', flexDirection: 'column', gap: 14 } },
      e('div', { style: { paddingTop: 6 } }, e('div', { style: { fontSize: 13, color: 'var(--muted)' } }, 'Good morning'), e('div', { style: { fontSize: 22, fontWeight: 800, letterSpacing: '-.02em' } }, 'Alex 👋')),
      e('div', { style: { borderRadius: 18, padding: 18, background: 'linear-gradient(150deg,var(--blue),var(--violet))', color: '#fff', display: 'flex', alignItems: 'center', gap: 14 } },
        e('div', { style: { position: 'relative', width: 72, height: 72, flex: 'none' } },
          e('svg', { width: 72, height: 72, viewBox: '0 0 80 80', style: { transform: 'rotate(-90deg)' } }, e('circle', { cx: 40, cy: 40, r: 30, fill: 'none', stroke: 'rgba(255,255,255,.25)', strokeWidth: 8 }), e('circle', { cx: 40, cy: 40, r: 30, fill: 'none', stroke: '#fff', strokeWidth: 8, strokeLinecap: 'round', strokeDasharray: 2 * Math.PI * 30, strokeDashoffset: 2 * Math.PI * 30 * 0.22 })),
          e('div', { style: { position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 800 } }, '782')),
        e('div', {}, e('div', { style: { fontSize: 12, opacity: .85 } }, 'Learning Score'), e('div', { style: { fontSize: 14, fontWeight: 700, marginTop: 3 } }, '▲ 34 this week'), e('div', { style: { fontSize: 12, opacity: .85, marginTop: 2 } }, 'Top 8%'))),
      e('div', { style: { display: 'flex', gap: 10 } },
        [['🔥', '24', 'Streak'], ['⏱', '142h', 'Studied'], ['✓', '86%', 'Done']].map((s, i) => e('div', { key: i, style: { flex: 1, borderRadius: 14, background: 'var(--surface)', border: '1px solid var(--border)', padding: '12px 8px', textAlign: 'center' } },
          e('div', { style: { fontSize: 16 } }, s[0]), e('div', { style: { fontSize: 17, fontWeight: 800, marginTop: 2 } }, s[1]), e('div', { style: { fontSize: 10.5, color: 'var(--muted)' } }, s[2])))),
      e('div', { style: { fontSize: 14, fontWeight: 700, marginTop: 2 } }, "Today's tasks"),
      [['AZ-104 practice set', false], ['NSG lab', true]].map((t, i) => e('div', { key: i, style: { display: 'flex', alignItems: 'center', gap: 10, padding: '11px 12px', borderRadius: 13, background: 'var(--surface)', border: '1px solid var(--border)' } },
        e('span', { style: { width: 20, height: 20, borderRadius: 7, flex: 'none', background: t[1] ? 'var(--emerald)' : 'transparent', border: t[1] ? 'none' : '2px solid var(--border-strong)', display: 'flex', alignItems: 'center', justifyContent: 'center' } }, t[1] ? e('svg', { width: 11, height: 11, viewBox: '0 0 24 24', fill: 'none', stroke: '#fff', strokeWidth: 3.5 }, e('path', { d: 'M20 6 9 17l-5-5' })) : null),
        e('span', { style: { fontSize: 13.5, fontWeight: 500, textDecoration: t[1] ? 'line-through' : 'none', color: t[1] ? 'var(--subtle)' : 'var(--text)' } }, t[0]))),
      e('div', { style: { borderRadius: 14, padding: 14, background: 'var(--blue-soft)', border: '1px solid var(--border)', display: 'flex', gap: 10, alignItems: 'flex-start' } },
        e('div', { style: { width: 24, height: 24, borderRadius: 7, flex: 'none', background: 'linear-gradient(135deg,var(--blue),var(--violet))', display: 'flex', alignItems: 'center', justifyContent: 'center' } }, e('svg', { width: 13, height: 13, viewBox: '0 0 24 24', fill: 'none', stroke: '#fff', strokeWidth: 2 }, e('path', { d: 'M12 3v3M12 18v3M3 12h3M18 12h3' }))),
        e('div', { style: { fontSize: 12.5, lineHeight: 1.45 } }, e('b', {}, 'Mentor AI:'), ' Move practice to Saturday — your completion there is 94%.')))
    const roadmap = e('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
      e('div', { style: { paddingTop: 6 } }, e('div', { style: { fontSize: 20, fontWeight: 800, letterSpacing: '-.02em' } }, 'Azure Architect'), e('div', { style: { fontSize: 12.5, color: 'var(--muted)', marginTop: 2 } }, '51% · Phase 2 of 4')),
      [['1', 'Foundation', 'AZ-900', 100, 'var(--emerald)'], ['2', 'Administration', 'AZ-104', 72, 'var(--blue)'], ['3', 'Architecture', 'AZ-305', 28, 'var(--violet)'], ['4', 'Mastery', 'DevOps', 4, 'var(--amber)']].map((p, i) =>
        e('div', { key: i, style: { display: 'flex', gap: 12, padding: '13px', borderRadius: 15, background: 'var(--surface)', border: '1px solid ' + (p[3] > 0 && p[3] < 100 ? 'var(--blue)' : 'var(--border)') } },
          e('div', { style: { width: 36, height: 36, flex: 'none', borderRadius: 11, background: p[3] === 100 ? p[4] : 'var(--surface-2)', color: p[3] === 100 ? '#fff' : p[4], display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 14 } }, p[3] === 100 ? '✓' : p[0]),
          e('div', { style: { flex: 1 } }, e('div', { style: { display: 'flex', justifyContent: 'space-between' } }, e('span', { style: { fontSize: 14, fontWeight: 700 } }, p[1]), e('span', { style: { fontSize: 10.5, fontWeight: 700, color: p[4] } }, p[2])),
            e('div', { style: { height: 5, borderRadius: 99, background: 'var(--surface-3)', marginTop: 8, overflow: 'hidden' } }, e('div', { style: { height: '100%', width: p[3] + '%', borderRadius: 99, background: p[4] } }))))))
    const mentor = e('div', { style: { display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 8 } },
      e('div', { style: { display: 'flex', justifyContent: 'flex-end' } }, e('div', { style: { maxWidth: '80%', padding: '10px 13px', borderRadius: '16px 16px 4px 16px', background: 'var(--blue)', color: '#fff', fontSize: 13 } }, 'What should I focus on this week?')),
      e('div', { style: { display: 'flex', gap: 9 } },
        e('div', { style: { width: 26, height: 26, flex: 'none', borderRadius: 8, background: 'linear-gradient(135deg,var(--blue),var(--violet))', display: 'flex', alignItems: 'center', justifyContent: 'center' } }, e('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: '#fff', strokeWidth: 2 }, e('path', { d: 'M12 3v3M12 18v3M3 12h3M18 12h3' }))),
        e('div', { style: { flex: 1 } }, e('div', { style: { fontSize: 13, lineHeight: 1.5 } }, "Focus on the Networking module — you're 72% through and AZ-104 is in 18 days."),
          e('div', { style: { marginTop: 10, padding: '9px 11px', borderRadius: 11, border: '1px solid var(--border)', background: 'var(--surface)' } },
            e('div', { style: { fontSize: 9.5, fontWeight: 700, color: 'var(--subtle)', letterSpacing: '.05em', marginBottom: 3 } }, 'SOURCE'),
            e('div', { style: { fontSize: 11.5, fontWeight: 600 } }, 'Your roadmap · Phase 2')))),
      e('div', { style: { marginTop: 'auto', display: 'flex', gap: 8, padding: '8px 8px 8px 14px', border: '1.5px solid var(--border-strong)', borderRadius: 14, background: 'var(--surface)' } },
        e('span', { style: { flex: 1, fontSize: 12.5, color: 'var(--subtle)', alignSelf: 'center' } }, 'Ask Mentor AI…'),
        e('div', { style: { width: 30, height: 30, borderRadius: 9, background: 'var(--blue)', display: 'flex', alignItems: 'center', justifyContent: 'center' } }, e('svg', { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: '#fff', strokeWidth: 2.2, strokeLinecap: 'round', strokeLinejoin: 'round' }, e('path', { d: 'M5 12h14M13 6l6 6-6 6' })))))
    const planner = e('div', { style: { display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 6 } },
      e('div', {}, e('div', { style: { fontSize: 20, fontWeight: 800, letterSpacing: '-.02em' } }, 'Wed, Feb 14'), e('div', { style: { fontSize: 12.5, color: 'var(--blue)', fontWeight: 600, marginTop: 2 } }, 'Exam day · 2 sessions')),
      [['9:00', 'AZ-104 mock exam', 'var(--amber)', 'var(--amber-soft)'], ['13:00', 'Lunch break', 'var(--subtle)', 'var(--surface-2)'], ['20:00', 'Review weak areas', 'var(--violet)', 'var(--violet-soft)']].map((s, i) =>
        e('div', { key: i, style: { display: 'flex', gap: 12 } },
          e('div', { style: { width: 42, fontSize: 11.5, fontWeight: 700, color: 'var(--muted)', paddingTop: 11, flex: 'none' } }, s[0]),
          e('div', { style: { flex: 1, padding: '11px 13px', borderRadius: 13, background: s[3], borderLeft: '3px solid ' + s[2] } }, e('div', { style: { fontSize: 13.5, fontWeight: 600 } }, s[1])))),
      e('div', { style: { marginTop: 8, padding: '12px', borderRadius: 13, border: '1.5px dashed var(--border-strong)', textAlign: 'center', fontSize: 12.5, color: 'var(--muted)', fontWeight: 600 } }, '+ Add study session'))
    return e('div', { style: { display: 'flex', flexDirection: 'column', gap: 18 } },
      e('div', {}, e('div', { style: { fontSize: 24, fontWeight: 800, letterSpacing: '-.03em' } }, 'Mobile App'),
        e('div', { style: { fontSize: 14.5, color: 'var(--muted)', marginTop: 3 } }, 'LearnFlow AI in your pocket — designed for one-handed use')),
      e('div', { style: { display: 'flex', gap: 32, flexWrap: 'wrap' } },
        this.phone('Home', home, 0),
        this.phone('Roadmap', roadmap, 1),
        this.phone('Planner', planner, 2),
        this.phone('AI Mentor', mentor, 3)))
  }
}
