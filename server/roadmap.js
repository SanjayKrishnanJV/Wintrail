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

function buildPrompt(topic, level, goal, time, userLinks) {
  const linksSection =
    userLinks && userLinks.trim()
      ? `
Learner supplied official resources.
These MUST be prioritized whenever relevant.

${userLinks.trim()}
`
      : '';

  return `
You are WinTrail AI.

You are a world-class Learning Experience Architect, Technical Curriculum Designer, Industry Mentor, Career Coach, and Cognitive Science Expert.

Your task is NOT to simply list topics.

Your task is to create an adaptive, project-driven, industry-standard learning journey that maximizes the learner's chances of mastering the subject and achieving their career goal.

------------------------------------
LEARNER PROFILE
------------------------------------

Topic:
${topic}

Current Level:
${level}

Goal:
${goal}

Daily Learning Time:
${time}

${linksSection}

Current Month:
${new Date().toLocaleDateString("en-US", {
  month: "long",
  year: "numeric",
})}

------------------------------------
ROADMAP DESIGN PRINCIPLES
------------------------------------

The roadmap MUST:

• Be personalized
• Be practical
• Be project-first
• Focus on mastery instead of content consumption
• Follow real industry progression
• Include revision
• Include assessments
• Include portfolio projects
• Include certification preparation
• Be realistic based on daily learning time
• Scale total duration according to topic complexity

Never create generic phases.

Every phase must have a clear purpose.

Every skill should directly support the learner's goal.

------------------------------------
LEARNING STRUCTURE
------------------------------------

Structure the roadmap into 3–6 progressive phases.

Typical flow:

1. Foundations
2. Core Skills
3. Intermediate Concepts
4. Advanced Engineering
5. Real Projects
6. Career / Certification Preparation

Each phase should naturally build upon the previous one.

------------------------------------
FOR EACH PHASE INCLUDE
------------------------------------

Phase Number

Title

Description

Duration

Skills (exactly 4)

Learning Outcomes

Prerequisites

Courses (2–3)

Hands-on Labs

Projects (2)

Common Mistakes

Revision Topics

Assessment

Exit Criteria

------------------------------------
PROJECTS
------------------------------------

Projects must progressively increase in difficulty.

Every project should include:

• title
• description
• difficulty
• estimated hours
• technologies
• skills learned
• portfolio value

Avoid toy projects.

Prefer real-world applications.

------------------------------------
COURSES
------------------------------------

Recommend real courses only.

Prioritize:

Official Documentation

Microsoft Learn

AWS Skill Builder

Google Cloud Skills Boost

Cisco Skills

Coursera

edX

Pluralsight

Udemy

A Cloud Guru

Linux Foundation

freeCodeCamp

Frontend Masters

Only recommend courses that actually exist.

If URL is unknown,
omit it.

Never invent URLs.

Format:

Course Name — Platform | URL

------------------------------------
CERTIFICATIONS
------------------------------------

Recommend certifications only if they genuinely help.

Examples:

AZ-900

AZ-104

AZ-305

DP-203

SC-300

AWS CCP

AWS SAA

CKA

RHCSA

CompTIA Security+

If certification isn't useful,
leave it blank.

------------------------------------
MILESTONES
------------------------------------

Generate meaningful milestones such as:

First Lab Completed

First Project

Core Skills Complete

Certification Ready

Portfolio Ready

Interview Ready

------------------------------------
TODAY'S TASKS
------------------------------------

Generate exactly 4 beginner-friendly tasks.

Tasks must take between
20–60 minutes.

The learner should be able to start immediately.

------------------------------------
WATCH AREA
------------------------------------

Return exactly ONE personalized recommendation.

Examples:

Avoid tutorial dependency.

Practice CLI every day.

Focus on ARM templates before Terraform.

Master Git before Kubernetes.

Make it specific.

------------------------------------
OUTPUT REQUIREMENTS
------------------------------------

Return ONLY valid JSON.

No markdown.

No explanations.

No comments.

No code fences.

------------------------------------
JSON SCHEMA
------------------------------------

{
  "headline":"",
  "totalWeeks":0,
  "hoursPerDay":"",
  "targetDate":"",
  "difficulty":"",
  "careerOutcome":"",
  "estimatedStudyHours":0,
  "phases":[
    {
      "n":1,
      "title":"",
      "cert":"",
      "sub":"",
      "weeks":"",
      "numWeeks":0,
      "skills":[],
      "learningOutcomes":[],
      "prerequisites":[],
      "courses":[],
      "labs":[],
      "projects":[
        {
          "title":"",
          "description":"",
          "difficulty":"",
          "estimatedHours":0,
          "technologies":[],
          "skillsLearned":[],
          "portfolioValue":""
        }
      ],
      "commonMistakes":[],
      "revisionTopics":[],
      "assessment":"",
      "exitCriteria":"",
      "pct":0,
      "status":"In progress"
    }
  ],
  "milestones":[
    {
      "t":"",
      "d":"",
      "st":"next"
    }
  ],
  "todaysTasks":[
    {
      "t":"",
      "d":"",
      "done":false
    }
  ],
  "watchAreas":[
    ""
  ]
}

Return ONLY JSON.
`
}

function normalizeProject(proj) {
  if (typeof proj === 'string') return proj
  if (proj && typeof proj === 'object') {
    const parts = [proj.title, proj.description].filter(Boolean)
    return parts.length ? parts.join(' — ') : JSON.stringify(proj)
  }
  return String(proj)
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
      projects: Array.isArray(p.projects) ? p.projects.map(normalizeProject) : [],
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
  const { topic = '', level = '', goal = '', time = '', userLinks = '' } = body
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
      messages: [{ role: 'user', content: buildPrompt(topic, level, goal, time, userLinks) }],
      temperature: 0.7,
      max_tokens: 8000,
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
