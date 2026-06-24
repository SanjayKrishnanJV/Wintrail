// Server-side personalized roadmap generator.
// Called when onboarding completes — takes the user's topic/level/goal/time
// and returns a structured JSON roadmap the client stores in state (and later persists).
// Shares provider config with server/mentor.js.

const DEFAULTS = {
  baseUrl: 'https://api.groq.com/openai/v1',
  model: 'llama-3.3-70b-versatile',
}

function getConfig(env = {}) {
  return {
    key: env.MENTOR_API_KEY || env.GROQ_API_KEY || env.XAI_API_KEY || '',
    baseUrl: env.MENTOR_BASE_URL || DEFAULTS.baseUrl,
    model: env.MENTOR_MODEL || DEFAULTS.model,
  }
}

function buildPrompt(topic, level, goal, time) {
  return `You are an expert learning architect. Create a highly personalized learning roadmap.

Inputs:
- Topic / Track: ${topic}
- Current level: ${level}
- Goal: ${goal}
- Daily time available: ${time}

Today's date: June 2026

Return ONLY a JSON object (no markdown fences, no extra text) with this exact structure:
{
  "headline": "<concise goal title matching the topic, e.g. 'Azure Cloud Architect'>",
  "totalWeeks": <integer 12-52, scaled to topic complexity and time commitment>,
  "hoursPerDay": "<matches the time input, e.g. '1 hour'>",
  "targetDate": "<Month Year calculated by adding totalWeeks to June 2026>",
  "phases": [
    {
      "n": 1,
      "title": "<phase name>",
      "cert": "<certification name or milestone label>",
      "sub": "<one-sentence description of what this phase covers>",
      "weeks": "Weeks 1–N",
      "numWeeks": <integer>,
      "skills": ["skill 1", "skill 2", "skill 3", "skill 4"],
      "courses": ["Course — Platform", "Course — Platform"],
      "projects": ["Hands-on project description", "Hands-on project description"],
      "assessment": "<exam name or capstone description>"
    }
  ],
  "milestones": [
    { "t": "<milestone title>", "d": "<e.g. 'Week 6' or 'Sep 2026'>", "st": "next" }
  ],
  "todaysTasks": [
    { "t": "<starter task description>", "d": "<duration, e.g. '30 min'>", "done": false }
  ],
  "watchAreas": ["<one specific, actionable tip for this exact learner profile>"]
}

Rules:
- 3–5 phases that progress logically from the learner's current level to their stated goal
- Each phase: 4 specific skills, 2–3 real courses (use real platforms: Microsoft Learn, Coursera, A Cloud Guru, Pluralsight, Udemy, etc.), 2–3 hands-on projects, one clear assessment
- milestones: 3–5 key checkpoints with realistic dates
- todaysTasks: 3–4 concrete day-1 starter tasks appropriate for the learner's current level
- watchAreas: exactly 1 entry — a specific tip for this learner (not generic advice)
- Be specific to the topic — use real certification names, real course names, real platforms`
}

function parseRoadmap(raw) {
  let s = String(raw || '').trim()
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try {
    const data = JSON.parse(s)
    if (!data || !Array.isArray(data.phases) || data.phases.length === 0) return null
    data.phases = data.phases.map((p, i) => ({
      ...p,
      n: i + 1,
      pct: 0,
      status: i === 0 ? 'In progress' : 'Locked',
    }))
    if (!Array.isArray(data.milestones)) data.milestones = []
    if (!Array.isArray(data.todaysTasks)) data.todaysTasks = []
    if (!Array.isArray(data.watchAreas)) data.watchAreas = []
    return data
  } catch {
    return null
  }
}

export async function generateRoadmap(body = {}, env = {}) {
  const { topic = '', level = '', goal = '', time = '' } = body
  const cfg = getConfig(env)

  if (!cfg.key) {
    const err = new Error('Missing API key. Add GROQ_API_KEY to .env and restart.')
    err.status = 400
    err.code = 'no_key'
    throw err
  }

  const res = await fetch(cfg.baseUrl.replace(/\/$/, '') + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.key },
    body: JSON.stringify({
      model: cfg.model,
      messages: [{ role: 'user', content: buildPrompt(topic, level, goal, time) }],
      temperature: 0.7,
      max_tokens: 2500,
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
  const raw = data?.choices?.[0]?.message?.content
  const roadmap = parseRoadmap(raw)

  if (!roadmap) {
    const err = new Error('Model returned an invalid roadmap structure.')
    err.status = 502
    throw err
  }

  return roadmap
}
