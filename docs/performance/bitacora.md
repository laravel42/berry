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
