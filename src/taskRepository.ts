import type { SupabaseClient } from '@supabase/supabase-js'
import type { Status } from './taskStorage'

export type Role = 'admin' | 'user'
export type AppUser = { id: string; email: string; display_name: string; role: Role }
export type RemoteTask = { id: string; title: string; status: Status; description: string; priority: string; due_date: string | null; created_at: string; assignee: string; labels: string[]; assignee_id: string; created_by: string }
export type TaskChanges = { title?: string; status?: Status; priority?: 'low' | 'normal' | 'high'; due_date?: string | null; assignee?: string; labels?: string[] }
const fields = 'id,title,status,description,priority,due_date,created_at,assignee,labels,assignee_id,created_by'

export function createTaskRepository(client: SupabaseClient) {
  async function initialize() {
    const { data: { session }, error } = await client.auth.getSession()
    if (error) throw error
    if (!session?.user) return null
    const { data: me, error: profileError } = await client.from('profiles').select('id,display_name,role').eq('id', session.user.id).single()
    if (profileError) throw profileError
    const { data: tasks, error: taskError } = await client.from('tasks').select(fields).order('created_at', { ascending: false })
    if (taskError) throw taskError
    let users: AppUser[] = []
    if (me.role === 'admin') {
      const { data: profiles, error: usersError } = await client.from('profiles').select('id,display_name,role').order('display_name')
      if (usersError) throw usersError
      users = (profiles ?? []).map((item) => ({ id: item.id, display_name: item.display_name, role: item.role, email: item.id === session.user.id ? session.user.email ?? '' : item.id })) as AppUser[]
    }
    return { userId: session.user.id, me: { ...me, email: session.user.email ?? '' } as AppUser, tasks: (tasks ?? []) as RemoteTask[], users }
  }
  async function create(userId: string, title: string, assigneeId = userId) { const { data, error } = await client.from('tasks').insert({ title, status: 'todo', created_by: userId, assignee_id: assigneeId }).select(fields).single(); if (error) throw error; return data as RemoteTask }
  async function update(id: string, changes: TaskChanges) { const { data, error } = await client.from('tasks').update(changes).eq('id', id).select(fields).single(); if (error) throw error; return data as RemoteTask }
  async function remove(id: string) { const { error } = await client.from('tasks').delete().eq('id', id); if (error) throw error }
  return { initialize, create, update, remove }
}
