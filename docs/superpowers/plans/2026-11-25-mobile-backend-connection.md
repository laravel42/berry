# Berry Mobile — Conexión al Backend (Fase 1: Login + Core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Conectar `apps/mobile` (`@berry/mobile`) al servidor real de Berry (`server-ts`, `/api/auth/*` y `/api/v1/*`) reemplazando los fixtures locales para login, selección de workspace, inbox, tareas (lista, detalle, creación, comentarios y decisiones humanas) y chat básico con agentes.

**Architecture:** Cliente HTTP tipado con autenticación Bearer vía Personal Access Token (`berry_pat_...`) guardado en `expo-secure-store` (Keychain/Keystore), obtenido automáticamente al hacer login con email/password (+ 2FA) contra Better Auth o pegando un PAT directamente (para cuentas solo-GitHub). El estado se divide en stores Zustand por dominio (`auth`, `workspace`, `inbox`, `issues`, `chat`) consumiendo el contrato actual de `server-ts` sin requerir cambios de backend en Fase 1.

**Tech Stack:** Expo SDK 58 (`expo-router`, `expo-secure-store`), React Native 0.88, React 19.3, TypeScript strict, Zustand 5, `node --experimental-strip-types --test` para tests unitarios de lógica/API/mappers.

**Spec:** Contrato HTTP/SSE en [`docs/api/gateway-v1.md`](../../../docs/api/gateway-v1.md), mapa de rutas en [`server-ts/ROUTING.md`](../../../server-ts/ROUTING.md) y reglas móviles en [`apps/mobile/AGENTS.md`](../../../apps/mobile/AGENTS.md).

## Global Constraints

- **TypeScript `strict` sin `any` ni `!`:** Todo código nuevo en `apps/mobile/src/` debe compilar limpio con `bun run --cwd apps/mobile typecheck` y pasar `bun run --cwd apps/mobile lint`.
- **Seguridad de credenciales:** Nunca guardar tokens, contraseñas ni cookies en `AsyncStorage`, `localStorage`, ni variables `EXPO_PUBLIC_*`. En iOS/Android usar `expo-secure-store` (`AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`); en Web preview mantener el token únicamente en memoria.
- **Variables de entorno Expo:** Acceder siempre como propiedad directa `process.env.EXPO_PUBLIC_BERRY_API_URL` (nunca destructuring).
- **Instalación de módulos Expo:** Instalar cualquier paquete de Expo únicamente con `bunx expo install <pkg>` dentro de `apps/mobile`. No crear ni editar manualmente carpetas `ios/` ni `android/`.
- **Contrato de Berry intacto:** Mantener compatibilidad estricta con `/api/v1` (campos `camelCase`, `ErrorEnvelope`, `Idempotency-Key` de 16–128 chars en POSTs de creación/decisión, tolerancia a campos desconocidos). Nunca marcar tareas como `done` sin acción explícita del humano; el flujo de `Approve` debe fusionar PR (`POST /api/v1/reviews/{runId}/merge`) antes de `PATCH /api/v1/issues/{id}` `{ status: "done" }` cuando exista PR abierto.
- **Sin cambios de backend requeridos en Fase 1:** Todos los endpoints consumidos existen hoy en `server-ts`. (CORS en Web preview local requiere apuntar vía proxy o probar contra nativo/Expo Go donde no aplica CORS.)
- **Errores ≠ estado vacío:** Un fallo de red o 5xx nunca debe renderizar la pantalla de "You’re caught up" ni listas vacías; siempre mostrar banner/estado de error con botón de reintento.

## Review Focus

1. **Token revocado o expirado en mitad de sesión (`401 UNAUTHENTICATED`):** Cualquier request que reciba `401` debe disparar un solo `onUnauthorized` (sin loops ni toasts duplicados), limpiar `SecureStore` y redirigir a `/sign-in` con mensaje claro. -> Pineado en **Task 1** (`client.test.ts`).
2. **Cuenta con 2FA activado o solo-GitHub (sin contraseña):** El login por email/password debe detectar `twoFactorRedirect` y pedir código TOTP antes de emitir el PAT; cuentas solo-GitHub deben poder autenticarse pegando un `berry_pat_` desde el mismo screen sin bloquearse. -> Pineado en **Task 2** (`service.test.ts`).
3. **Cambio de workspace con rutas dependientes de `currentWorkspaceId` (`GET /api/v1/agents`):** Al cambiar workspace hay que llamar `POST /api/v1/workspaces/{id}/select` (cuerpo vacío) *antes* de recargar agentes, tableros, proyectos, inbox e issues, y cancelar/ignorar respuestas obsoletas de un workspace anterior. -> Pineado en **Task 3** (`mappers.test.ts` + `workspace.test.ts`).
4. **Acciones optimistas de Inbox con fallo de red:** Si `POST /api/v1/inbox/{id}/{action}` falla, la fila debe revertir su estado `read`/`archived` exacto y mostrar toast de error. -> Pineado en **Task 4** (`inbox.test.ts`).
5. **Conflicto de merge al aprobar una revisión (`409 MERGE_CONFLICT` / `MERGE_REFUSED`):** Si `POST /api/v1/reviews/{runId}/merge` devuelve `409`, NO se debe ejecutar `PATCH /api/v1/issues/{id}` `{ status: "done" }`; mostrar el mensaje del servidor al humano y refrescar la tarea. -> Pineado en **Task 5** (`decisions.test.ts`).

---

## File Structure

- `apps/mobile/package.json` — agrega `expo-secure-store` y script `"test"`.
- `apps/mobile/src/lib/env.ts` — resolución y validación de URL del servidor Berry.
- `apps/mobile/src/auth/storage.ts` — persistencia segura de credenciales (`expo-secure-store` nativo / memoria en web).
- `apps/mobile/src/auth/service.ts` — `probeServer`, login email+password+2FA con intercambio a PAT, login directo por PAT, logout con revocación.
- `apps/mobile/src/api/client.ts` — cliente HTTP tipado (`BerryClient`, `ApiClientError`, `Idempotency-Key`, manejo de `401`).
- `apps/mobile/src/api/types.ts` — tipos wire del contrato `/api/v1` (bootstrap, workspace, board, issue, comment, activity, inbox, approval, review, conversation).
- `apps/mobile/src/api/workspace.ts`, `inbox.ts`, `issues.ts`, `decisions.ts`, `conversations.ts` — wrappers por dominio sobre `BerryClient`.
- `apps/mobile/src/model/mappers.ts` — conversión entre wire `/api/v1` y modelos de vista (actores dinámicos, estados, fechas relativas).
- `apps/mobile/src/store/auth-store.ts`, `workspace-store.ts`, `inbox-store.ts`, `issues-store.ts`, `chat-store.ts` — stores Zustand reales por dominio.
- `apps/mobile/src/app/sign-in.tsx` + `src/features/auth/sign-in-screen.tsx` — pantalla de login (URL + Email/Password + 2FA + PAT).
- `apps/mobile/src/components/workspace-sheet.tsx` — selector de workspace + botón de cerrar sesión desde el header.
- Pantallas existentes adaptadas: `src/app/_layout.tsx`, `src/components/screen-header.tsx`, `src/components/tab-bar.tsx`, `src/features/inbox/inbox-screen.tsx`, `src/features/tasks/tasks-screen.tsx`, `src/features/tasks/issue-screen.tsx`, `src/features/tasks/compose-screen.tsx`, `src/features/chat/chat-list-screen.tsx`, `src/features/chat/conversation-screen.tsx`, `src/features/chat/new-chat-screen.tsx`.

---

### Task 0: Actualizar Expo SDK 57 → SDK 58

**Files:**
- Modify: `apps/mobile/package.json`
- Modify: `bun.lock`
- Modify (solo si SDK 58 lo exige): `apps/mobile/app.json`, archivos de `apps/mobile/src/` con warnings/tipos rotos

**Interfaces:**
- Consumes: ninguna.
- Produces: entorno `apps/mobile` corriendo sobre `expo` ~58.x (`runtimeVersion: "exposdk:58.0.0"`), compatible con Expo Go SDK 58, pasando `typecheck`, `lint`, `expo-doctor` y Metro bundle.

- [ ] **Step 1: Actualizar `expo` a `^58.0.0` y resolver dependencias compatibles**

Run: `cd apps/mobile && bun add expo@^58.0.0 && bunx expo install --fix`

- [ ] **Step 2: Ejecutar diagnósticos, typecheck y lint**

Run: `cd apps/mobile && bunx expo-doctor && bun run typecheck && bun run lint`
Expected: `expo-doctor` sin errores críticos de versiones, `tsc --noEmit` exit 0, `expo lint` exit 0.

- [ ] **Step 3: Verificar manifest `exposdk:58.0.0` y render en Metro**

Arrancar Metro en `:8082`, comprobar que `GET /` con `expo-platform: ios` devuelva `"runtimeVersion":"exposdk:58.0.0"` y que la vista web cargue con `0` errores en consola.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/package.json bun.lock
git commit -m "chore(mobile): upgrade Expo SDK from 57 to 58 (BERR-00)"
```

---

### Task 1: Configuración de servidor, SecureStore y cliente HTTP tipado

**Files:**
- Modify: `apps/mobile/package.json`
- Create: `apps/mobile/src/lib/env.ts`
- Create: `apps/mobile/src/auth/storage.ts`
- Create: `apps/mobile/src/api/types.ts`
- Create: `apps/mobile/src/api/client.ts`
- Test: `apps/mobile/src/lib/env.test.ts`
- Test: `apps/mobile/src/api/client.test.ts`

**Interfaces:**
- Consumes: `expo-secure-store`, global `fetch`.
- Produces:
  - `normalizeServerUrl(raw: string): { ok: true; url: string } | { ok: false; error: string }` y `defaultServerUrl(): string` en `src/lib/env.ts`
  - `StoredSession = { baseUrl: string; token: string; tokenId: string | null; workspaceId: string | null }` y `sessionStorage: { load(): Promise<StoredSession | null>; save(s: StoredSession): Promise<void>; updateWorkspace(id: string | null): Promise<void>; clear(): Promise<void> }` en `src/auth/storage.ts`
  - `ApiClientError` (`status`, `code`, `message`, `requestId`, `details`) y `createBerryClient(opts: { baseUrl: string; token: string | null; fetchImpl?: typeof fetch; onUnauthorized?: () => void }): BerryClient` con `request<T>(path, init?)`, `get<T>(path)`, `post<T>(path, body?, opts?: { idempotent?: boolean; emptyBody?: boolean })`, `patch<T>(path, body)`, `del(path)` en `src/api/client.ts`

- [ ] **Step 1: Instalar `expo-secure-store` y agregar script `test`**

Run: `cd apps/mobile && bunx expo install expo-secure-store`
Agregar en `apps/mobile/package.json`: `"test": "node --experimental-strip-types --test src/**/*.test.ts"`.

- [ ] **Step 2: Escribir tests que fallen para `normalizeServerUrl` y `BerryClient`**

En `apps/mobile/src/lib/env.test.ts`:
- `test('normalizes https URL and strips trailing slash')`: `'https://berry.example.com/'` -> `{ ok: true, url: 'https://berry.example.com' }`.
- `test('allows http only for localhost and private LAN IPs')`: `'http://192.168.100.6:4000'` -> `ok: true`; `'http://berry.example.com'` -> `{ ok: false, error: ... }`.
- `test('rejects invalid or non-http schemes')`: `'ftp://foo'` -> `ok: false`.

En `apps/mobile/src/api/client.test.ts`:
- `test('sends Bearer token and parses camelCase JSON')`: verifica header `Authorization: Bearer berry_pat_test`.
- `test('attaches Idempotency-Key of length 16..128 when idempotent=true')`: verifica existencia y longitud del header.
- `test('parses Berry ErrorEnvelope into ApiClientError')`: respuesta `422` con `{ error: { code: 'VALIDATION_FAILED', message, requestId, details } }` lanza `ApiClientError` con esos campos exactos.
- `test('fires onUnauthorized exactly once across concurrent 401 responses')` *(Review Focus #1)*: dos `get()` concurrentes que responden `401` invocan `onUnauthorized` exactamente 1 vez.

- [ ] **Step 3: Correr tests y verificar que fallan**

Run: `bun run --cwd apps/mobile test`
Expected: FAIL (`ERR_MODULE_NOT_FOUND`).

- [ ] **Step 4: Implementar `env.ts`, `storage.ts`, `types.ts` y `client.ts`**

- `src/lib/env.ts`: leer `process.env.EXPO_PUBLIC_BERRY_API_URL ?? ''` con acceso directo; permitir `https:` siempre y `http:` solo en `localhost`, `127.0.0.1`, `10.*`, `192.168.*`, `172.16-31.*`.
- `src/auth/storage.ts`: en `Platform.OS === 'web'` usar variable en memoria (nunca `localStorage`); en iOS/Android usar `SecureStore.getItemAsync` / `setItemAsync` / `deleteItemAsync` con `keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`.
- `src/api/types.ts`: definir interfaces estrictas para `ServerConfig`, `BootstrapResponse`, `ApiWorkspace`, `ApiBoard`, `ApiMember`, `ApiAgent`, `ApiProject`, `ApiInboxItem`, `ApiIssue`, `ApiComment`, `ApiActivityItem`, `ApiApproval`, `ApiReviewItem`, `ApiConversation`, `ApiConversationMessage`, `PageInfo`.
- `src/api/client.ts`: implementar `createBerryClient`, generación de `Idempotency-Key` con `crypto.randomUUID()` (fallback hex de 32 chars si no existe en runtime), y latch de `onUnauthorized` por instancia del cliente.

- [ ] **Step 5: Verificar tests, typecheck y lint**

Run: `bun run --cwd apps/mobile test && bun run --cwd apps/mobile typecheck && bun run --cwd apps/mobile lint`
Expected: PASS en los 3 comandos.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/package.json apps/mobile/src/lib/env.ts apps/mobile/src/lib/env.test.ts apps/mobile/src/auth/storage.ts apps/mobile/src/api/types.ts apps/mobile/src/api/client.ts apps/mobile/src/api/client.test.ts
git commit -m "feat(mobile): add secure session storage and typed Berry API client (BERR-00)"
```

---

### Task 2: Autenticación (Email + Password + 2FA -> PAT, Login por PAT, Logout y Auth Gate)

**Files:**
- Create: `apps/mobile/src/auth/service.ts`
- Create: `apps/mobile/src/store/auth-store.ts`
- Create: `apps/mobile/src/features/auth/sign-in-screen.tsx`
- Create: `apps/mobile/src/app/sign-in.tsx`
- Modify: `apps/mobile/src/app/_layout.tsx`
- Test: `apps/mobile/src/auth/service.test.ts`

**Interfaces:**
- Consumes: `normalizeServerUrl` (`src/lib/env.ts`), `sessionStorage` (`src/auth/storage.ts`), `createBerryClient`, `ApiClientError` (`src/api/client.ts`).
- Produces:
  - `probeServer(baseUrl: string, fetchImpl?): Promise<ServerConfig>`
  - `signInWithPassword(input: { baseUrl: string; email: string; password: string; deviceLabel: string }, fetchImpl?): Promise<{ kind: 'signed_in'; token: string; tokenId: string } | { kind: 'two_factor'; sessionCookie: string }>`
  - `verifyTwoFactorAndMintToken(input: { baseUrl: string; sessionCookie: string; code: string; deviceLabel: string }, fetchImpl?): Promise<{ token: string; tokenId: string }>`
  - `signInWithPat(baseUrl: string, token: string, fetchImpl?): Promise<BootstrapResponse>`
  - `signOutSession(client: BerryClient, tokenId: string | null): Promise<void>`
  - `useAuthStore` (`status`, `baseUrl`, `token`, `user`, `workspaces`, `currentWorkspaceId`, `capabilities`, `client`, `hydrate()`, `completeSignIn()`, `setCurrentWorkspace()`, `logout()`).

- [ ] **Step 1: Escribir tests que fallen en `apps/mobile/src/auth/service.test.ts`**

- `test('extracts berry.session_token cookie and mints mobile PAT on email sign-in')`: mockea `POST /api/auth/sign-in/email` devolviendo `Set-Cookie: berry.session_token=abc; Path=/; HttpOnly`, verifica `POST /api/v1/tokens` con `Cookie` + `Idempotency-Key` + `expiresAt` a +90 días, y verifica `POST /api/auth/sign-out` posterior.
- `test('returns two_factor challenge when Better Auth responds with twoFactorRedirect')` *(Review Focus #2)*: mockea `{ twoFactorRedirect: true }` y verifica que `verifyTwoFactorAndMintToken` llama `POST /api/auth/two-factor/verify-totp` antes de emitir el PAT.
- `test('rejects malformed PAT before making network call and verifies valid PAT via bootstrap')` *(Review Focus #2)*: `'invalid'` rechaza localmente sin `fetch`; `'berry_pat_123_abc'` llama `GET /api/v1/me/bootstrap`.
- `test('signOutSession revokes mobile PAT and tolerates 401/404')`: llama `DELETE /api/v1/tokens/{id}` con cuerpo vacío; no lanza si responde `401` o `404`.

- [ ] **Step 2: Correr tests y verificar que fallan**

Run: `bun run --cwd apps/mobile test`
Expected: FAIL.

- [ ] **Step 3: Implementar `src/auth/service.ts` y `src/store/auth-store.ts`**

- Nota de compatibilidad Better Auth: enviar `Origin: baseUrl` en `POST /api/auth/*` cuando sea nativo para satisfacer `trustedOrigins` sin tocar `server-ts`. En `POST /api/v1/tokens` enviar el `Cookie` recolectado y **no** enviar `Origin` (evita `CrossOriginRefused`).
- En `useAuthStore.hydrate()`: leer `sessionStorage.load()`, instanciar `BerryClient` con `onUnauthorized: () => void get().logout({ reason: 'expired' })`, llamar `GET /api/v1/config` y `GET /api/v1/me/bootstrap`; si `401`, limpiar sesión y pasar a `signed_out`; si error de red, mantener estado de error recuperable con botón *Retry* (sin borrar la sesión guardada).

- [ ] **Step 4: Implementar `sign-in-screen.tsx`, `app/sign-in.tsx` y auth gate en `app/_layout.tsx`**

- `SignInScreen`: estilo oscuro Berry (`colors.void`, `BerryMark`, `JetBrainsMono`), campo URL del servidor (prellenado con `defaultServerUrl()`), `Segmented` entre **Email** y **API key (`berry_pat_`)**, paso condicional de código 2FA (6 dígitos), botón principal en `colors.berry` con estado `disabled` y mensajes claros desde `ApiClientError`.
- `app/_layout.tsx`: ejecutar `hydrate()` al arrancar, mantener splash/loading mientras `status === 'hydrating'`, redirigir automáticamente entre `/sign-in` y `/(tabs)` según `status`.

- [ ] **Step 5: Verificar tests, typecheck, lint y prueba manual en Expo**

Run: `bun run --cwd apps/mobile test && bun run --cwd apps/mobile typecheck && bun run --cwd apps/mobile lint`
Expected: PASS. Confirmar login real contra `http://127.0.0.1:4000` (o túnel) con `edo@laravel42.com` y con un `berry_pat_`.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/auth/ apps/mobile/src/store/auth-store.ts apps/mobile/src/features/auth/ apps/mobile/src/app/sign-in.tsx apps/mobile/src/app/_layout.tsx
git commit -m "feat(mobile): add sign-in, 2FA/PAT exchange, and session gate (BERR-00)"
```

---

### Task 3: Contexto de Workspace, Directorio Real (Members, Agents, Projects) y Selector de Workspace

**Files:**
- Create: `apps/mobile/src/api/workspace.ts`
- Create: `apps/mobile/src/model/mappers.ts`
- Create: `apps/mobile/src/store/workspace-store.ts`
- Create: `apps/mobile/src/components/workspace-sheet.tsx`
- Modify: `apps/mobile/src/components/screen-header.tsx`
- Modify: `apps/mobile/src/components/avatar.tsx`
- Modify: `apps/mobile/src/theme/tokens.ts`
- Test: `apps/mobile/src/model/mappers.test.ts`
- Test: `apps/mobile/src/api/workspace.test.ts`

**Interfaces:**
- Consumes: `useAuthStore` (`client`, `workspaces`, `currentWorkspaceId`, `logout`), `BerryClient`.
- Produces:
  - `ActorView = { id: string; type: 'user' | 'agent'; name: string; initials: string; avatarUrl: string | null; roleKey?: string | null }`
  - `mapApiStatus(s: string): IssueStatusUi` (`inProgress` -> `in_progress`, `inReview` -> `in_review`, fallback seguro a `backlog`) y `mapUiStatusToApi(s: IssueStatusUi): string`
  - `formatRelativeTime(iso: string, nowMs?: number): string`
  - `useWorkspaceStore` (`workspace`, `boards`, `defaultBoardId`, `members`, `agents`, `projects`, `actorsById`, `loading`, `error`, `loadWorkspace(workspaceId)`, `switchWorkspace(workspaceId)`).

- [ ] **Step 1: Escribir tests que fallen en `mappers.test.ts` y `workspace.test.ts`**

En `src/model/mappers.test.ts`:
- `test('maps camelCase API statuses and preserves unknown fallback')`: `'inProgress'` -> `'in_progress'`, `'inReview'` -> `'in_review'`, `'cancelled'` -> `'cancelled'`, `'future_status'` -> `'backlog'`.
- `test('derives initials cleanly for 1-word, 2-word, and empty names')`: `'Héctor Martínez'` -> `'HM'`, `'Builder'` -> `'BU'`, `''` -> `'?'`.
- `test('formats relative timestamps in m/h/d')`.

En `src/api/workspace.test.ts`:
- `test('switchWorkspace calls POST /api/v1/workspaces/:id/select before GET /api/v1/agents')` *(Review Focus #3)*: verifica el orden exacto de llamadas y cuerpo vacío en `/select`, luego carga paralela de `boards`, `members`, `agents` y `projects`.
- `test('discards stale workspace load when user switches again mid-flight')` *(Review Focus #3)*: una promesa lenta del workspace A no sobrescribe el estado del workspace B.

- [ ] **Step 2: Correr tests y verificar que fallan**

Run: `bun run --cwd apps/mobile test`
Expected: FAIL.

- [ ] **Step 3: Implementar `workspace.ts`, `mappers.ts`, `workspace-store.ts` y `workspace-sheet.tsx`**

- `src/api/workspace.ts`: llamar `POST /api/v1/workspaces/{id}/select` (`emptyBody: true`), `GET /api/v1/boards?first=50` (filtrar por `board.workspaceId === workspaceId`), `GET /api/v1/workspaces/{id}/members?first=100`, `GET /api/v1/agents?first=100`, `GET /api/v1/projects?first=100`.
- `src/components/avatar.tsx`: aceptar `ActorView` (o `{ name, initials, isAgent, avatarUrl }`) en lugar de solo `PersonId` estático.
- `src/components/workspace-sheet.tsx` + `screen-header.tsx`: tocar el logo/nombre del workspace en la cabecera abre un modal/sheet con la lista real de workspaces (marcando el activo), datos del usuario actual y botón **Log out**. Eliminar `workspaceName = 'laravel42'` fijo en `tokens.ts`.

- [ ] **Step 4: Verificar tests, typecheck y lint**

Run: `bun run --cwd apps/mobile test && bun run --cwd apps/mobile typecheck && bun run --cwd apps/mobile lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/api/workspace.ts apps/mobile/src/api/workspace.test.ts apps/mobile/src/model/mappers.ts apps/mobile/src/model/mappers.test.ts apps/mobile/src/store/workspace-store.ts apps/mobile/src/components/workspace-sheet.tsx apps/mobile/src/components/screen-header.tsx apps/mobile/src/components/avatar.tsx apps/mobile/src/theme/tokens.ts
git commit -m "feat(mobile): wire workspace bootstrap, directory, and workspace switcher (BERR-00)"
```

---

### Task 4: Inbox Real (Notificaciones, Filtros, Swipe Actions y Badge)

**Files:**
- Create: `apps/mobile/src/api/inbox.ts`
- Create: `apps/mobile/src/store/inbox-store.ts`
- Modify: `apps/mobile/src/features/inbox/inbox-screen.tsx`
- Modify: `apps/mobile/src/components/tab-bar.tsx`
- Test: `apps/mobile/src/api/inbox.test.ts`

**Interfaces:**
- Consumes: `BerryClient`, `useAuthStore`, `useWorkspaceStore`.
- Produces:
  - `listInbox(client, { workspaceId, state, after? })` -> `GET /api/v1/inbox`
  - `fetchUnreadCount(client, workspaceId)` -> `GET /api/v1/inbox/unread-count`
  - `applyInboxItemAction(client, itemId, action, workspaceId)` -> `POST /api/v1/inbox/{itemId}/{action}`
  - `bulkInboxAction(client, workspaceId, itemIds, action)` -> `POST /api/v1/inbox/bulk`
  - `useInboxStore` (`items`, `unreadCount`, `view`, `onlyNeeds`, `loading`, `refreshing`, `error`, `hasNextPage`, `load()`, `loadMore()`, `toggleRead(id)`, `archive(id)`, `markAllRead()`).

- [ ] **Step 1: Escribir tests que fallen en `apps/mobile/src/api/inbox.test.ts`**

- `test('maps server eventType/category/approvalId into mobile InboxItem display kind and needs flag')`: `approvalId != null` o `eventType` de review/failed/blocked marca `needs: true`; `eventType` desconocido cae en categoría neutral sin romper.
- `test('reverts optimistic read/archive state when server returns 500')` *(Review Focus #4)*: `toggleRead` y `archive` actualizan inmediatamente y restauran el estado anterior exacto cuando la promesa falla, exponiendo `error`/toast.
- `test('markAllRead batches active unread itemIds into POST /api/v1/inbox/bulk')`: envía `{ workspaceId, itemIds, action: 'read' }` en lotes de máximo 200.

- [ ] **Step 2: Correr tests y verificar que fallan**

Run: `bun run --cwd apps/mobile test`
Expected: FAIL.

- [ ] **Step 3: Implementar `src/api/inbox.ts` y `src/store/inbox-store.ts`**

- Seguir el contrato real en `server-ts/src/mounts/inbox.ts`: query `workspaceId`, `state=active|archived`, `first=50`, `after`; body `{ workspaceId }` en `POST /:itemId/:action`.

- [ ] **Step 4: Conectar `inbox-screen.tsx` y `tab-bar.tsx` a `useInboxStore`**

- Agregar `RefreshControl` en `ScrollView` / `FlatList` y botón "Load more" cuando `hasNextPage`.
- Mostrar estado de error con botón **Retry** si `error != null` (nunca mostrar "You’re caught up" cuando falló la red).
- Conectar el badge del tab Inbox en `tab-bar.tsx` a `useInboxStore((s) => s.unreadCount)`.

- [ ] **Step 5: Verificar tests, typecheck y lint**

Run: `bun run --cwd apps/mobile test && bun run --cwd apps/mobile typecheck && bun run --cwd apps/mobile lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/api/inbox.ts apps/mobile/src/api/inbox.test.ts apps/mobile/src/store/inbox-store.ts apps/mobile/src/features/inbox/inbox-screen.tsx apps/mobile/src/components/tab-bar.tsx
git commit -m "feat(mobile): connect inbox list, swipe actions, and unread badge to API (BERR-00)"
```

---

### Task 5: Mis Tareas (`Assigned`/`Created`), Detalle de Tarea y Decisiones Humanas

**Files:**
- Create: `apps/mobile/src/api/issues.ts`
- Create: `apps/mobile/src/api/decisions.ts`
- Create: `apps/mobile/src/store/issues-store.ts`
- Modify: `apps/mobile/src/features/tasks/tasks-screen.tsx`
- Modify: `apps/mobile/src/features/tasks/issue-screen.tsx`
- Test: `apps/mobile/src/api/issues.test.ts`
- Test: `apps/mobile/src/api/decisions.test.ts`

**Interfaces:**
- Consumes: `BerryClient`, `useAuthStore`, `useWorkspaceStore`, `useInboxStore`, `mapApiStatus` / `mapUiStatusToApi`.
- Produces:
  - `listBoardIssues(client, boardId, after?)`, `getIssue(client, ref)`, `patchIssue(client, ref, patch)`, `listIssueComments(client, ref)`, `createIssueComment(client, ref, body)`, `listIssueActivity(client, ref)`, `restartIssueRun(client, ref)` en `src/api/issues.ts`
  - `listOpenReviews(client, workspaceId)`, `mergeReviewPullRequest(client, runId)`, `listPendingApprovals(client, workspaceId, issueId?)`, `resolveApproval(client, approvalId, decision: 'approve' | 'reject', note?)` en `src/api/decisions.ts`
  - `useIssuesStore` (`issues`, `detailsById`, `mineTab`, `loading`, `error`, `loadIssues()`, `loadIssueDetail(ref)`, `approveIssue(issueId)`, `sendBackIssue(issueId, note)`, `decideApproval(approvalId, decision, note?)`, `retryRun(issueId)`, `addComment(issueId, body)`).

- [ ] **Step 1: Escribir tests que fallen en `issues.test.ts` y `decisions.test.ts`**

En `src/api/issues.test.ts`:
- `test('splits board issues into assigned-to-me and created-by-me by authenticated user id')`.
- `test('createIssueComment sends Idempotency-Key and { body }')`.
- `test('sendBackIssue posts feedback comment then PATCHes status to todo')`.

En `src/api/decisions.test.ts`:
- `test('approveIssue merges open PR before PATCH status=done')`: verifica `POST /api/v1/reviews/{runId}/merge` seguido de `PATCH /api/v1/issues/{id}` `{ status: 'done' }`.
- `test('approveIssue aborts PATCH done when merge returns 409 MERGE_CONFLICT')` *(Review Focus #5)*: verifica que NO se llama `PATCH /api/v1/issues/{id}` y se devuelve el mensaje de conflicto al caller.
- `test('decideApproval posts to /api/v1/approvals/:id/approve|reject with Idempotency-Key')`.

- [ ] **Step 2: Correr tests y verificar que fallan**

Run: `bun run --cwd apps/mobile test`
Expected: FAIL.

- [ ] **Step 3: Implementar `src/api/issues.ts`, `src/api/decisions.ts` y `src/store/issues-store.ts`**

- Al abrir detalle (`loadIssueDetail`), cargar en paralelo: `getIssue`, `listIssueComments`, `listIssueActivity`, `listPendingApprovals(wsId, issue.id)` y `listOpenReviews(wsId)` (para detectar si hay PR pendiente por fusionar).
- Combinar comentarios y actividad cronológicamente en la sección `Activity`.

- [ ] **Step 4: Conectar `tasks-screen.tsx` y `issue-screen.tsx`**

- En `tasks-screen.tsx`: pull-to-refresh, estado vacío real vs error con retry, badge de identificador real (`issue.identifier`, no `BERR-${id}` hardcodeado).
- En `issue-screen.tsx`:
  - Mostrar barra de **Review** cuando `issue.status === 'in_review'` (`Approve` / `Send back`), mostrando tarjeta de PR si existe en `openReviews`.
  - Mostrar barra de **Approval** cuando exista una aprobación `pending` para la tarea (`Approve` / `Reject`).
  - Mostrar botón **Retry run** cuando el último run/notificación esté en fallo (`POST /api/v1/issues/{ref}/runs/restart`).
  - Conectar el composer de comentarios a `addComment` con estado de envío deshabilitado mientras envía.

- [ ] **Step 5: Verificar tests, typecheck y lint**

Run: `bun run --cwd apps/mobile test && bun run --cwd apps/mobile typecheck && bun run --cwd apps/mobile lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/api/issues.ts apps/mobile/src/api/issues.test.ts apps/mobile/src/api/decisions.ts apps/mobile/src/api/decisions.test.ts apps/mobile/src/store/issues-store.ts apps/mobile/src/features/tasks/tasks-screen.tsx apps/mobile/src/features/tasks/issue-screen.tsx
git commit -m "feat(mobile): connect my tasks, issue detail, comments, and human decision gates (BERR-00)"
```

---

### Task 6: Crear Tarea Real (`ComposeScreen`) con Agentes, Miembros y Proyectos del Workspace

**Files:**
- Modify: `apps/mobile/src/api/issues.ts`
- Modify: `apps/mobile/src/lib/suggest.ts`
- Modify: `apps/mobile/src/features/tasks/compose-screen.tsx`
- Test: `apps/mobile/src/lib/suggest.test.ts`

**Interfaces:**
- Consumes: `useWorkspaceStore` (`defaultBoardId`, `agents`, `members`, `projects`), `useIssuesStore` (`addCreatedIssue`).
- Produces:
  - `createIssue(client, input: { boardId: string; title: string; description: string | null; priority: IssuePriority; status: 'backlog' | 'todo'; assignee: { type: 'user' | 'agent'; id: string } | null; projectId?: string | null }): Promise<ApiIssue>` en `src/api/issues.ts`
  - `suggestFromDirectory(prompt: string, directory: { meId: string; agents: ActorView[]; members: ActorView[]; projects: ApiProject[] }, overrides)` en `src/lib/suggest.ts`.

- [ ] **Step 1: Escribir tests que fallen en `apps/mobile/src/lib/suggest.test.ts`**

- `test('matches real workspace agent by roleKey/name keywords instead of hardcoded fixture ids')`: con agentes reales UUID, `"fix migration bug"` sugiere el agente con `roleKey: 'software-engineer'` o nombre coincidente; si no existe, cae en el primer agente disponible o `null`.
- `test('createIssue never sends inReview or done as initial status')`: cuando el usuario activa "Start immediately" sobre un agente, envía `status: 'todo'` (dejando al servidor auto-despachar el run, según `server-ts/src/mounts/issues.ts`).

- [ ] **Step 2: Correr tests y verificar que fallan**

Run: `bun run --cwd apps/mobile test`
Expected: FAIL.

- [ ] **Step 3: Implementar `createIssue`, actualizar `suggest.ts` y conectar `compose-screen.tsx`**

- Enviar `POST /api/v1/issues` con `Idempotency-Key`.
- En `compose-screen.tsx`: poblar pickers de Assignee y Project con datos reales de `useWorkspaceStore`, deshabilitar botón durante envío, mostrar errores de validación (`ApiClientError.details.fields`) si el servidor responde `422`, insertar el issue creado en `useIssuesStore` y navegar a `/issue/[id]`.

- [ ] **Step 4: Verificar tests, typecheck y lint**

Run: `bun run --cwd apps/mobile test && bun run --cwd apps/mobile typecheck && bun run --cwd apps/mobile lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/api/issues.ts apps/mobile/src/lib/suggest.ts apps/mobile/src/lib/suggest.test.ts apps/mobile/src/features/tasks/compose-screen.tsx
git commit -m "feat(mobile): wire task creation modal to real workspace board and directory (BERR-00)"
```

---

### Task 7: Chat Básico con Agentes y Refresco en Foreground (y Limpieza de Fixtures)

**Files:**
- Create: `apps/mobile/src/api/conversations.ts`
- Create: `apps/mobile/src/store/chat-store.ts`
- Create: `apps/mobile/src/hooks/use-foreground-refresh.ts`
- Modify: `apps/mobile/src/features/chat/chat-list-screen.tsx`
- Modify: `apps/mobile/src/features/chat/new-chat-screen.tsx`
- Modify: `apps/mobile/src/features/chat/conversation-screen.tsx`
- Modify: `apps/mobile/src/components/tab-bar.tsx`
- Test: `apps/mobile/src/api/conversations.test.ts`

**Interfaces:**
- Consumes: `BerryClient`, `useAuthStore`, `useWorkspaceStore` (`agents`).
- Produces:
  - `listConversations(client)`, `openAgentConversation(client, agentId)`, `createAgentConversation(client, agentId, title?)`, `listConversationMessages(client, id)`, `sendConversationMessage(client, id, body)`, `markConversationRead(client, id)` en `src/api/conversations.ts`
  - `useChatStore` (`conversations`, `messagesById`, `pendingRunByChat`, `loading`, `error`, `loadConversations()`, `openWithAgent(agentId)`, `loadMessages(id)`, `send(id, body)`, `markRead(id)`).

- [ ] **Step 1: Escribir tests que fallen en `apps/mobile/src/api/conversations.test.ts`**

- `test('sendConversationMessage posts { body } and handles 202 queued response')`: devuelve `{ messageId, runId, queued: true }`.
- `test('surfaces 503 AGENT_TASKS_UNAVAILABLE clearly without losing typed message')`: cuando el servidor no tiene runtime conectado, muestra el mensaje de `ApiClientError` y conserva el mensaje de usuario si ya fue persistido.

- [ ] **Step 2: Correr tests y verificar que fallan**

Run: `bun run --cwd apps/mobile test`
Expected: FAIL.

- [ ] **Step 3: Implementar `conversations.ts`, `chat-store.ts` y `use-foreground-refresh.ts`**

- Polling ligero (cada 2.5s con backoff y limpieza en unmount) mientras exista un `runId` en curso en la conversación abierta; detenerlo cuando llega el mensaje de respuesta del agente o pasan 60s.
- `use-foreground-refresh.ts`: escuchar `AppState` (`active`) para refrescar `unreadCount`, inbox e issues del workspace activo al volver a la app.

- [ ] **Step 4: Conectar pantallas de Chat y ocultar features de Fase 2**

- En `chat-list-screen.tsx` y `new-chat-screen.tsx`: listar conversaciones reales y agentes del workspace (`POST /api/v1/conversations/agents/{agentId}`).
- En `conversation-screen.tsx`: renderizar mensajes reales de usuario/agente, mostrar indicador *"Agent is working…"* mientras el run está en cola, y ocultar botones de nota de voz grabada / llamada de audio-video cuando no estén implementados en Fase 1 (dejando `call-screen.tsx` listo para Fase 2 con LiveKit).
- Conectar el badge de Chat en `tab-bar.tsx` a `useChatStore` y remover dependencias de `src/store/app-store.ts` y `src/data/seed.ts` en las rutas activas.

- [ ] **Step 5: Verificación final de Fase 1**

Run: `bun run --cwd apps/mobile test && bun run --cwd apps/mobile typecheck && bun run --cwd apps/mobile lint`
Expected: PASS en todos los checks, 0 errores en consola al navegar Login -> Inbox -> My tasks -> Issue detail -> Compose -> Chat -> Workspace switch -> Logout.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/api/conversations.ts apps/mobile/src/api/conversations.test.ts apps/mobile/src/store/chat-store.ts apps/mobile/src/hooks/use-foreground-refresh.ts apps/mobile/src/features/chat/ apps/mobile/src/components/tab-bar.tsx
git commit -m "feat(mobile): connect agent chat and foreground sync to Berry API (BERR-00)"
```

---

## Fuera de alcance en Fase 1 (Fase 2 sugerida)

- **GitHub OAuth nativo (`berry://auth/callback`):** `expo-web-browser` + soporte de redirect móvil / `@better-auth/expo` en `server-ts`.
- **Realtime SSE (`GET /api/v1/events`):** stream persistente con reconexión por cursor `since` (complementando el polling/foreground refresh de Fase 1).
- **Llamadas y notas de voz reales:** `@livekit/react-native` conectado a `POST /api/v1/voice/token` + grabación real con `expo-audio`.
- **Push notifications y distribución:** `expo-notifications` + tabla de device tokens en backend + `eas.json` y builds `development` / `preview` / `production` con `bunx eas-cli build`.
