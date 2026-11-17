# NextPlayG Task Board

A responsive task manager built with React, TypeScript, Vite, and Supabase. Users sign in with an account; administrators can assign tasks to users, while RLS keeps task access restricted.

## Features

- Create, edit, move, and delete tasks, with an undo action for the most recent deletion.
- Move tasks using drag and drop or the status selector.
- Create custom labels and assign multiple labels to a task.
- Set priority, a due date, and an optional assignee name. Overdue and upcoming tasks are highlighted.
- Search by title and combine filters for priority, assignee, and label.
- Email/password sign-up and sign-in, with a role-aware admin view.
- Administrators can assign new tasks to registered users.
- Keep tasks private with Supabase row-level security; the role is enforced in the database, not only in the UI.

The app reuses an anonymous session in the same browser. Anonymous sessions are not recoverable on another device or after clearing browser data. Real-time collaboration is not implemented.

## Run locally

1. Install Node.js 24 and npm. The project was tested with Node.js 24.13.1.
2. Install dependencies:

   ```bash
   npm install
   ```

3. Create a Supabase project and enable email/password sign-ins in its authentication settings.
4. For a new database, run [`supabase.sql`](supabase.sql). For an existing installation, run [`supabase-auth-migration.sql`](supabase-auth-migration.sql) (and the feature migration if needed).
5. Copy `.env.example` to `.env` and add your project's URL and publishable key. Never use a service-role key in the frontend or commit `.env`.
6. Start the development server:

   ```bash
   npm run dev
   ```

   Open the local URL printed by Vite. Restart the server after changing `.env`.

## Checks

```bash
npm run build
npm run typecheck
npm run lint
npm run test:unit
npm run test:e2e
```

## Administrator setup

Create the first account through the app, then run the commented `update public.profiles ...` statement at the end of the SQL file, replacing the email address. New accounts are regular users by default. Do not put a service-role key in `.env` or frontend code.

## Data and privacy

The schema and row-level security policies are documented in [`supabase.sql`](supabase.sql). Policies allow users to access assigned tasks and administrators to manage all tasks. Authentication sessions are managed by Supabase; passwords are never handled or stored by the app.

Administrators delete accounts through the protected [`delete-user`](supabase/functions/delete-user/index.ts) Edge Function. Deploy it with `supabase functions deploy delete-user`; never expose the `SUPABASE_SERVICE_ROLE_KEY` in the browser. Set `APP_ORIGINS` as a function secret to a comma-separated list such as `http://localhost:5173,https://tu-dominio.com`. Supabase Auth stores password hashes; the application does not store or encrypt passwords itself.

## CAPTCHA and rate limits

The frontend supports Cloudflare Turnstile when `VITE_TURNSTILE_SITE_KEY` is present. Create a Turnstile widget, add its site key to `.env`, and configure its secret in Supabase under **Authentication → Bot and Abuse Protection → CAPTCHA**. Supabase will then validate the `captchaToken` sent by sign-in and sign-up. Configure sign-in and sign-up limits under **Authentication → Rate Limits**.

La aplicación usa confirmación por correo para validar las cuentas. Los administradores se autorizan mediante su sesión autenticada y el rol `admin` almacenado en `profiles`; la función `is_admin()` y las políticas RLS no dependen de MFA.

En producción, configura el secreto `APP_ORIGINS` de la función con una lista separada por comas que incluya el origen de la app. Si ya existe ese secreto, añade también `http://localhost:5173` para probar localmente; si no existe, desarrollo local permite `localhost:5173` y `127.0.0.1:5173` por defecto.

The login screen includes password recovery through `resetPasswordForEmail`. Configure the application's URL in **Authentication → URL Configuration** in Supabase and add the local and production URLs to the redirect allow list. The recovery link returns to the app, where the user sets a new password of at least 12 characters.

## WhatsApp task notifications

The project includes [`supabase/functions/send-task-assignment/index.ts`](supabase/functions/send-task-assignment/index.ts). It sends a WhatsApp Cloud API template when a task is assigned or reassigned. Run [`supabase.sql`](supabase.sql) first, then deploy the function and configure secrets outside the frontend:

```bash
supabase functions deploy send-task-assignment --no-verify-jwt
supabase secrets set TASK_WEBHOOK_SECRET="generate-a-long-random-secret" META_WHATSAPP_PHONE_NUMBER_ID="your-meta-phone-number-id" META_WHATSAPP_ACCESS_TOKEN="your-meta-access-token" META_TASK_TEMPLATE_NAME="task_assigned" META_TASK_TEMPLATE_LANGUAGE="es" META_GRAPH_VERSION="v23.0"
```

Create and approve a WhatsApp utility template named `task_assigned` with two body variables: recipient name and task title. In Supabase, create a Database Webhook for `public.tasks` on `INSERT` and `UPDATE`, targeting this Edge Function, and add the header `x-task-webhook-secret` with the same secret. The function skips updates where the assignee did not change. Never place the Meta access token in `.env` or browser code.
