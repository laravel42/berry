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
