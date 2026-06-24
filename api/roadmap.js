import { generateRoadmap } from '../server/roadmap.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  try {
    const result = await generateRoadmap(req.body || {}, process.env)
    res.status(200).json(result)
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message, code: err.code || null })
  }
}
