# Bitácora de rendimiento

- Rama: `fix/mobile`
- Baseline: `eb730a90`
- Fuente de verdad del diagnóstico: [lighthouse-2026-11-19.md](lighthouse-2026-11-19.md)
- Archivos ajenos sin comitear que nadie toca: `frontend/.env.example`, `frontend/tsconfig.json` (lo reescribe `next build`)

## Verificación (idéntica en cada puerta)

```bash
cd frontend && bunx eslint <archivos tocados>
cd frontend && NEXT_DIST_DIR=.next-tunnel bun run build:check
```

`.next-verify` lo está sirviendo `next start` en :3001; no se construye ahí durante la cadena.

## Lighthouse móvil base (local, prod, Chrome headless, 2000 tareas)

| Ruta | Score | FCP | LCP | TBT | SI |
|------|-------|-----|-----|-----|----|
| `/laravel42/tasks` | 55 | 1.4 s | 7.6 s | 850 ms | 3.3 s |
| `/laravel42/issue/LAR-100` | 55 | 1.4 s | 7.2 s | 900 ms | 2.3 s |
| `/sign-in` (anónimo) | 79 | 1.4 s | 4.7 s | 210 ms | 1.5 s |

Por el túnel de Cloudflare el usuario midió 36.

## Tareas

| Id | Tarea | Alcance | Commit | Estado |
|----|-------|---------|--------|--------|
| T1 | Lista de tareas virtualizada, sin motion por fila, un solo set en la carga | components/common/issues, board-column, lib/issues.ts | 67672e20 | verde (build + lint; DOM de Tasks 1216 nodos con 2000 tareas, scroll OK). Cabeceras de grupo ya no son sticky |
| T2 | Dedupe de GETs en vuelo; views/milestones/cycles/approvals/runs en idle | lib/api.ts, hooks/use-hydrate-workspace-data.ts | e3689168 | verde (build + lint). SSE ya recargaba por id. Quedan repeticiones no solapadas en el detalle |
| T2b | La dedupe no cruza sesiones (generación + reset en sign-in/out) | lib/api.ts, store/session-store.ts | b76d3b2d | verde (build + lint). Correctivo por revisión de seguridad |
| T3 | Palette, chat flotante, CreateWorkspaceDialog, Tiptap y logos bajo demanda; LazyMotion en SegmentIndicator | app/[orgId]/layout.tsx, workspace-runtime, issue-description, logos, segment-indicator | 84731b7d | verde (build + lint; detalle sin chunks de Tiptap/palette/chat hasta usarlos) |
| T3b | Caret en el editor de descripción tras cargarlo | issue-description.tsx | 589394ee | verde (clic real: foco en el editable). Lo tecleado antes de que cargue el chunk se pierde |
| T4 | El shell se pinta durante el boot si hay cookie; /sign-in sin esperar bootstrap; /boards solo con sesión | app/layout.tsx, session-gate.tsx, session-store.ts | a4f98071 | verde (build; Tasks/Inbox/Projects/detalle OK en prod :3001; sign-in Lighthouse 79→94). El detalle de tarea espera a las 2000 tareas (~5 s local) |
| T5 | Menú contextual y pickers de fila construidos solo al abrirse | issue-context-menu, assignee-user, option-picker, status-picker | ec25ad25 | verde (build + lint; CPU de carga en dev 4.7→3.8 s, IssueContextMenu fuera del perfil; menú y submenú Assignee OK) |
| T6 | Sin prefetch de las secciones del rail/pestañas | components/layout/shell/* | 95841b3a | verde (build). La parte de abrir SSE tarde se revirtió en d9a6bbe9: sin cursor obligaba a recargar las 2000 tareas |
| T7 | Server: `serverTime` en bootstrap y `since` en /events | server-ts mounts/events.ts, me.ts, tests, gateway-v1.md | 5b562b40 | verde (typecheck; events.test 12/12; e2e: since reproduce solo lo nuevo). Hallazgo: sin cursor el stream reproducía TODO el backlog en cada carga |
| T8 | Streams SSE abiertos tras la carga, en idle, con `since` | lib/auth, session-store, use-*-event-stream, lib/events, lib/runs | ab9e7506 | verde (build + lint; URLs con since; tiempo real comprobado cambiando un título por la API) |

## Medición con sesión real (puppeteer + Lighthouse, tras T4)

La medición base con `--extra-headers` acababa en 401 a mitad de carga y no reflejaba la página con datos; no comparar con ella.

| Ruta | Score | TBT | SI |
|------|-------|-----|----|
| Tasks | 41 | 3 320 ms | 5.4 s |
| Detalle | 46 | 2 460 ms | 3.1 s |
| Inbox | 45 | 2 290 ms | 2.1 s |

Perfil de CPU en dev (Tasks, 15 s): `IssueContextMenu` ~900 ms inclusivo (monta el menú completo por fila), `AssigneeUser` ~200 ms, `OptionPicker` ~100 ms.

Tras T6 (prod :3001): Tasks 40 (TBT 3 150 ms), detalle 46, Inbox 45. LCP observado 3.3 s, simulado ~66 s: Lantern cuenta las dos conexiones SSE (que no terminan) como dependencias del LCP. De ahí T7/T8: `since` en /events + `serverTime` en bootstrap para abrir los streams tras el primer pintado sin perder eventos.

Tras T8 (prod :3001): Tasks **53** (LCP 5.1 s, TBT 1 600 ms), detalle **74** (LCP 2.4 s, TBT 1 210 ms), Inbox **77** (TBT 830 ms). LCP observado en Tasks 1.6 s.
