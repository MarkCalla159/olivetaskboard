import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

type WebhookPayload = {
  type: 'INSERT' | 'UPDATE'
  table?: string
  schema?: string
  record: { id: string; title: string; assignee_id: string; created_by: string }
  old_record: { assignee_id?: string } | null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

function constantTimeEqual(left: string, right: string) {
  const maxLength = Math.max(left.length, right.length)
  let difference = left.length ^ right.length
  for (let index = 0; index < maxLength; index += 1) difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0)
  return difference === 0
}

Deno.serve(async request => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  const expectedSecret = Deno.env.get('TASK_WEBHOOK_SECRET') || ''
  const providedSecret = request.headers.get('x-task-webhook-secret') || ''
  if (expectedSecret.length < 32 || !constantTimeEqual(providedSecret, expectedSecret)) return json({ error: 'Unauthorized' }, 401)

  let payload: WebhookPayload
  try { payload = await request.json() as WebhookPayload } catch { return json({ error: 'Invalid JSON' }, 400) }
  if ((payload.table && payload.table !== 'tasks') || (payload.schema && payload.schema !== 'public')) return json({ error: 'Invalid webhook source' }, 400)
  if (!['INSERT', 'UPDATE'].includes(payload.type) || !payload.record?.id || !payload.record.assignee_id || !payload.record.created_by || typeof payload.record.title !== 'string' || payload.record.title.trim().length === 0 || payload.record.title.length > 300) return json({ error: 'Invalid webhook payload' }, 400)
  if (!UUID.test(payload.record.id) || !UUID.test(payload.record.assignee_id) || !UUID.test(payload.record.created_by)) return json({ error: 'Invalid identifiers' }, 400)
  if (payload.type === 'INSERT' && payload.record.created_by === payload.record.assignee_id) return json({ skipped: true, reason: 'Self-created task' })
  if (payload.type === 'UPDATE' && payload.old_record?.assignee_id === payload.record.assignee_id) return json({ skipped: true, reason: 'Assignment did not change' })

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const eventKey = `${payload.type}:${payload.record.id}:${payload.record.assignee_id}`
  // Keep the idempotency table bounded. This is best-effort and never affects delivery.
  await supabase.from('task_notification_events').delete().lt('updated_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()).in('status', ['sent', 'skipped', 'failed'])
  const { data: existing, error: existingError } = await supabase.from('task_notification_events').select('status,updated_at').eq('event_key', eventKey).maybeSingle()
  if (existingError) return json({ error: 'Could not check notification state' }, 500)
  if (existing?.status === 'sent' || existing?.status === 'skipped') return json({ skipped: true, reason: 'Duplicate event' })
  if (existing?.status === 'processing' && Date.now() - new Date(existing.updated_at).getTime() < 10 * 60 * 1000) return json({ skipped: true, reason: 'Event already processing' })

  const claim = existing
    ? await supabase.from('task_notification_events').update({ status: 'processing', updated_at: new Date().toISOString() }).eq('event_key', eventKey)
    : await supabase.from('task_notification_events').insert({ event_key: eventKey, task_id: payload.record.id, assignee_id: payload.record.assignee_id, status: 'processing' })
  if (claim.error) {
    if (claim.error.code === '23505') return json({ skipped: true, reason: 'Duplicate event' })
    return json({ error: 'Could not claim notification event' }, 500)
  }

  const mark = async (status: 'sent' | 'skipped' | 'failed') => { await supabase.from('task_notification_events').update({ status, updated_at: new Date().toISOString() }).eq('event_key', eventKey) }
  const { data: profile, error: profileError } = await supabase.from('profiles').select('display_name,phone_number,whatsapp_notifications_enabled').eq('id', payload.record.assignee_id).single()
  if (profileError) { await mark('failed'); return json({ error: 'Could not load assignee' }, 500) }
  if (!profile.whatsapp_notifications_enabled || !profile.phone_number) { await mark('skipped'); return json({ skipped: true, reason: 'WhatsApp is not configured for this user' }) }

  const phoneNumberId = Deno.env.get('META_WHATSAPP_PHONE_NUMBER_ID')
  const accessToken = Deno.env.get('META_WHATSAPP_ACCESS_TOKEN')
  const graphVersion = Deno.env.get('META_GRAPH_VERSION') || 'v23.0'
  const templateName = Deno.env.get('META_TASK_TEMPLATE_NAME') || 'task_assigned'
  const languageCode = Deno.env.get('META_TASK_TEMPLATE_LANGUAGE') || 'es'
  if (!phoneNumberId || !accessToken) { await mark('failed'); return json({ error: 'WhatsApp secrets are not configured' }, 500) }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)
  let providerResponse: Response
  try {
    providerResponse = await fetch(`https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`, {
      method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: profile.phone_number, type: 'template', template: { name: templateName, language: { code: languageCode }, components: [{ type: 'body', parameters: [{ type: 'text', text: profile.display_name || 'Usuario' }, { type: 'text', text: payload.record.title }] }] } }),
      signal: controller.signal,
    })
  } catch {
    await mark('failed')
    return json({ error: 'WhatsApp provider unavailable' }, 502)
  } finally {
    clearTimeout(timeout)
  }
  if (!providerResponse.ok) { await mark('failed'); return json({ error: 'WhatsApp provider rejected the message' }, 502) }
  await mark('sent')
  return json({ sent: true })
})
