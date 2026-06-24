import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

// null when env vars are absent — app falls back to localStorage-only mode
export const supabase = url && key ? createClient(url, key) : null
