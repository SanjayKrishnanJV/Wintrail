// Server-side Mentor AI handler.
//
// Provider-agnostic: talks to any OpenAI-compatible chat-completions API
// (Groq by default; xAI Grok / Google Gemini / OpenAI via env overrides).
// The API key lives here on the server and is NEVER shipped to the browser.
//
// This is a plain async function so it can be reused as-is inside a serverless
// function (Vercel/Netlify) when you deploy — see vite.config.js for the dev
// proxy that calls it.

const DEFAULTS = {
  baseUrl: 'https://api.groq.com/openai/v1',
  model: 'llama-3.3-70b-versatile',
}

function getConfig(env = {}) {
  const key = env.MENTOR_API_KEY || env.GROQ_API_KEY || env.XAI_API_KEY || ''
  return {
    key,
    baseUrl: env.MENTOR_BASE_URL || DEFAULTS.baseUrl,
    model: env.MENTOR_MODEL || DEFAULTS.model,
  }
}

function systemPrompt(context) {
  return [
    'You are Mentor AI, a personal learning architect inside the LearnFlow AI app.',
    'You coach the learner toward their goal with concrete, encouraging, practical guidance.',
    '',
    'LEARNER CONTEXT (ground every answer in this; never contradict it):',
    JSON.stringify(context || {}, null, 2),
    '',
    'Rules:',
    '- Be specific and actionable. Prefer concrete next steps over generic advice.',
    '- Ground claims in the LEARNER CONTEXT. Do NOT invent exam dates, scores, or URLs.',
    '- For "sources", only cite things derived from the LEARNER CONTEXT (e.g. "Your roadmap · Phase 2") or well-known official resources by name. Never fabricate links. If unsure, use an empty list.',
    '- Keep "text" to 2-4 sentences. Put steps or lists in "bullets" (0-5 short items).',
    '- Respond ONLY with minified JSON in exactly this shape: {"text": string, "bullets": string[], "sources": [{"t": string, "m": string}]}.',
  ].join('\n')
}

function parseReply(raw) {
  let s = String(raw || '').trim()
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '') // strip code fences if any
  try {
    const o = JSON.parse(s)
    return {
      text: typeof o.text === 'string' ? o.text : '',
      bullets: Array.isArray(o.bullets) ? o.bullets.filter((x) => typeof x === 'string') : [],
      sources: Array.isArray(o.sources)
        ? o.sources.filter((x) => x && typeof x.t === 'string').map((x) => ({ t: x.t, m: typeof x.m === 'string' ? x.m : '' }))
        : [],
    }
  } catch {
    return { text: s, bullets: [], sources: [] }
  }
}

export async function mentorReply(body = {}, env = {}) {
  const { messages = [], context = null } = body
  const cfg = getConfig(env)
  if (!cfg.key) {
    const err = new Error('Missing API key. Copy .env.example to .env, add your GROQ_API_KEY, and restart the dev server.')
    err.status = 400
    err.code = 'no_key'
    throw err
  }

  const chat = [
    { role: 'system', content: systemPrompt(context) },
    ...messages
      .filter((m) => m && m.content)
      .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content) })),
  ]

  const res = await fetch(cfg.baseUrl.replace(/\/$/, '') + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.key },
    body: JSON.stringify({
      model: cfg.model,
      messages: chat,
      temperature: 0.6,
      max_tokens: 800,
      response_format: { type: 'json_object' },
    }),
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    const err = new Error('Provider error ' + res.status + (detail ? ': ' + detail.slice(0, 300) : ''))
    err.status = 502
    throw err
  }

  const data = await res.json()
  const raw = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content
  return parseReply(raw)
}
