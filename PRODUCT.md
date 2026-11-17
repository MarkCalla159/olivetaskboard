# Product

## Platform

Web application for olive-export teams.

## Product Purpose

Olive Taskboard lets authenticated users manage their own tasks while administrators assign work and review the progress of all users.

## Capabilities and constraints

- Accounts use Supabase Auth with email confirmation, email/password recovery and CAPTCHA support.
- The board organizes tasks into Por hacer, En progreso, En revisión and Completadas.
- Users can create, update status and delete their own tasks. Administrators can assign tasks and access the separate admin dashboard after email verification.
- Row Level Security is the authority for task and profile access; frontend role checks are only a presentation layer.
- The browser contains only the Supabase publishable key. Service-role keys and notification secrets belong exclusively to Edge Function secrets.
- Assignment notifications are handled by the `send-task-assignment` Edge Function with idempotency protection.

## Brand commitments

Use the Olive Taskboard name with Poppins for interface text and the approved display typeface for the wordmark.
