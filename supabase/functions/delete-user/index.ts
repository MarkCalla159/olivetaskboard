import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const configuredOrigins = (Deno.env.get('APP_ORIGINS') || '').split(',').map(origin => origin.trim()).filter(Boolean)
const allowedOrigins = configuredOrigins.length ? configuredOrigins : ['http://localhost:5173', 'http://127.0.0.1:5173']
const response = (body: unknown, status = 200, origin?: string) => {
  const headers = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  if (origin && allowedOrigins.includes(origin)) { headers.set('Access-Control-Allow-Origin', origin); headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS'); headers.set('Access-Control-Allow-Headers', 'authorization, x-client-info, apikey, content-type'); headers.set('Vary', 'Origin') }
  // HTTP 204 responses must not contain a response body.
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers })
}

Deno.serve(async (request) => {
  const origin = request.headers.get('Origin') || undefined
  if (request.method === 'OPTIONS') return allowedOrigins.includes(origin || '') ? response({}, 204, origin) : response({ error: 'CORS origin denied' }, 403)
  if (origin && !allowedOrigins.includes(origin)) return response({ error: 'CORS origin denied' }, 403)
  if (request.method !== 'POST') return response({ error: 'Method not allowed' }, 405, origin)
  const authorization = request.headers.get('Authorization')
  const token = authorization?.replace(/^Bearer\s+/i, '')
  if (!token || token.length > 4096) return response({ error: 'Unauthorized' }, 401, origin)

  let body: { userId?: string }
  try { body = await request.json() as { userId?: string } } catch { return response({ error: 'Invalid JSON' }, 400, origin) }
  if (!body.userId || !/^[0-9a-f-]{36}$/i.test(body.userId)) return response({ error: 'Invalid userId' }, 400, origin)

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: authData, error: authError } = await supabase.auth.getUser(token)
  if (authError || !authData.user) return response({ error: 'Unauthorized' }, 401, origin)
  if (authData.user.id === body.userId) return response({ error: 'The current administrator cannot delete their own account' }, 400, origin)

  const scopedClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: `Bearer ${token}` } } })
  const { data: isAdmin, error: roleError } = await scopedClient.rpc('is_admin')
  if (roleError || isAdmin !== true) return response({ error: 'Forbidden' }, 403, origin)

  const { error: deleteError } = await supabase.auth.admin.deleteUser(body.userId)
  if (deleteError) return response({ error: 'Could not delete user' }, 500, origin)
  return response({ deleted: true }, 200, origin)
})
