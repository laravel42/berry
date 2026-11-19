# Auditoría de rendimiento: Lighthouse 37 (2026-11-19)

Documento de trabajo. Cada punto se analiza y se corrige por separado; marca el estado en la tabla al cerrarlo.

## Cómo se midió

- **Build de producción**: `next build` en `.next-verify` y `next start -p 3001`. Las rutas de la app son todas `ƒ` (dinámicas), porque el root layout lee `cookies()`.
- **API**: `server-ts` en dev contra una PGlite **temporal** (migraciones + `db:seed` + 150 tareas de prueba), no contra `.berry`.
- **Navegador**: Claude in Chrome, abierto por la IP de la LAN (`192.168.100.6`), porque ese Chrome corre en otra máquina. En las métricas de pintura hay un sesgo: la ventana estaba tapada y renderizaba a unos 1.5 fps, así que FCP y LCP medidos ahí **no son fiables**. Sí son fiables los bytes, la cascada de red, el número de peticiones y las long tasks del hilo principal.
- **Hardware**: todo se midió sin throttling en un equipo de 12 núcleos. Lighthouse móvil simula una CPU 4× más lenta, unos 1.6 Mbps y 150 ms de RTT. Las cifras de CPU de abajo hay que multiplicarlas aproximadamente ×4 para compararlas con lo que ve Lighthouse.

### Entorno de revisión manual (datos reales)

- El board **Tasks** del workspace `eduardo` en `.berry` tiene **300 tareas** (EDU-1 … EDU-300), creadas por la API con estados, prioridades, fechas y descripciones variados. Reparto: backlog 89, todo 68, in_progress 49, done 48, in_review 32, blocked 8, cancelled 6. 166 están asignadas a Edo; ninguna a agentes, así que no se generaron runs.
- Producción: `next start -p 3001` sobre `.next-verify`, construido sin `NEXT_PUBLIC_AUTO_LOGIN_EMAIL`.
- En dev, Better Auth solo confía en `http://localhost:3000`. Para iniciar sesión en `:3001` o desde la IP de la LAN, la API tiene que arrancar con los orígenes extra en el entorno del proceso. Esto no cambia `.env`:

```bash
BERRY_AUTH_TRUSTED_ORIGINS="http://localhost:3000,http://localhost:3001,http://127.0.0.1:3001,http://192.168.100.6:3000,http://192.168.100.6:3001" bun run dev:server
```

### Cómo se explica el 37

Lighthouse (v10+) pondera FCP 10 %, Speed Index 10 %, **LCP 25 %**, **TBT 30 %** y CLS 25 %. El CLS medido es 0, lo que ya aporta unos 25 puntos. Para quedarse en 37, LCP y TBT tienen que estar prácticamente en 0. **Los dos frentes son el LCP (el contenido llega tarde) y el TBT (demasiado JS y renders largos).** CLS no es problema.

> Si el 37 salió de `next dev` (puerto 3000 con `bun run dev:frontend`), ese número no sirve. Ver el [punto 0](#0-medir-sobre-producción-no-sobre-next-dev).

## Resumen priorizado

| # | Problema | Métrica afectada | Impacto | Esfuerzo | Estado |
|---|----------|------------------|---------|----------|--------|
| 0 | Medir sobre `next dev` en lugar de producción | Todas | Invalida la medición | Nulo | Pendiente de confirmar |
| 1 | La app se pinta solo en cliente: el HTML es "Loading Berry" y el contenido espera JS + 2 rondas de API | **LCP**, SI | Muy alto | Alto | Pendiente |
| 2 | Lista de tareas sin virtualizar, con `motion.div` + `useDrag` por fila y un render completo por cada página de datos | **TBT** | Muy alto | Medio | Pendiente |
| 3 | Cada ruta hidrata el workspace entero (21 peticiones en Tasks, 45 en el detalle), con duplicados y la descarga de **todas** las tareas del board | **TBT**, LCP | Alto | Medio | Pendiente |
| 4 | JS inicial de unos 1.6 MB raw / 500 KB gzip en cada ruta; el detalle de tarea carga Tiptap (564 KB) nada más abrir | TBT, LCP | Alto | Medio | Pendiente |
| 5 | Catálogo i18n completo (20 namespaces) incrustado en cada HTML | LCP, TBT | Medio | Bajo | Pendiente |
| 6 | Fuentes: Inter de 206 KB + JetBrains Mono de 46 KB precargadas en todas las páginas | LCP, FCP | Medio | Bajo | Pendiente |
| 7 | Prefetch de 15–22 rutas RSC dinámicas en el arranque | Red, TBT | Medio-bajo | Bajo | Pendiente |
| 8 | Hoja de estilos global única de 214 KB que bloquea el render | FCP | Bajo-medio | Medio | Pendiente |
| 9 | `/sign-in`: cascada bootstrap(401) → `/config` antes de pintar el formulario | LCP (si se auditó esa ruta) | Medio | Bajo-medio | Pendiente |

---

## 0. Medir sobre producción, no sobre `next dev`

**Qué pasa.** En dev, `/sign-in` descarga **10.1 MB de JS** (1.6 MB transferidos) en 22 scripts:

- `@remixicon/react` completo: 4.2 MB (en producción se elimina por tree-shaking).
- `react-dom` de desarrollo: 1 MB.
- `next-devtools`: 866 KB.
- Los locales de `zod`: 458 KB.

Además, [next.config.ts:94](../../frontend/next.config.ts:94) sirve `/_next/static` con `no-store` en desarrollo, así que no hay caché, y las fuentes se descargaron dos veces. En producción esa misma página son **758 KB raw / 227 KB gzip**.

**Qué hacer.** Medir siempre sobre un build de producción, en una ventana de incógnito, con la pestaña visible y la configuración "Mobile" por defecto:

```bash
cd frontend && NEXT_DIST_DIR=.next-verify bun run build:check
```

```bash
cd frontend && NEXT_DIST_DIR=.next-verify node node_modules/next/dist/bin/next start -p 3001
```

Hay que anotar qué URL se audita: la landing (`/`, Astro, ya ligera), `/sign-in` o una ruta de la app. Cada una tiene un problema distinto.

**Referencia.** La landing de marketing (`/` sin sesión) es estática: 5 KB de JS, sin long tasks y FCP en unos 250 ms. **No es la culpable.**

---

## 1. La app se pinta solo en cliente detrás de `SessionGate`

**Qué pasa.** [SessionGate](../../frontend/components/layout/session-gate.tsx:59) envuelve todo el árbol en el root layout. Mientras `status === 'booting'` devuelve `BootScreen` ([session-gate.tsx:100](../../frontend/components/layout/session-gate.tsx:100)). Como en el servidor el store siempre arranca en `booting`, **el HTML de cualquier ruta es solo "Loading Berry"**. El servidor genera igualmente el payload RSC de la página completa, pero no se pinta. El contenido real aparece después de cuatro pasos encadenados:

1. Descargar, parsear e hidratar unos 500 KB gzip de JS (punto 4).
2. `GET /api/v1/me/bootstrap` + `GET /api/v1/boards` ([session-store.ts:91](../../frontend/store/session-store.ts:91)).
3. Con eso, la segunda ola: ~18 peticiones de `useHydrateWorkspaceData` (punto 3).
4. Renderizar la página con los datos.

**Evidencia** (prod, `/berry/tasks`, sin throttling):

- TTFB: 249 ms.
- JS listo: unos 300 ms.
- Bootstrap: 316–441 ms.
- Segunda ola: 612–1115 ms.
- Primer texto real en `main`: unos 980 ms.

Con la red y la CPU de Lighthouse móvil, esa cadena son varios segundos de LCP. El FCP sale bueno porque el boot screen se pinta pronto, pero el LCP es el contenido.

**Opciones** (de menor a mayor esfuerzo):

- Pintar la estructura en servidor. `SessionGate` puede renderizar `children` en SSR cuando existe la cookie `berry.session_token`, igual que ya hace `app/page.tsx`, y dejar el gate solo para redirigir. Las páginas renderizarían su esqueleto (shell, cabecera, skeleton de la lista) en el primer byte.
- Resolver la sesión en el servidor. Un layout server-side podría leer `/me/bootstrap` con la cookie y pasar `user`, `workspace` y `boardId` como estado inicial del store. Eso elimina una ronda completa.
- A más largo plazo, que las páginas principales (Tasks, Inbox, detalle de tarea) obtengan su primer bloque de datos en el servidor (RSC) en lugar de en efectos.

**Cómo verificar.** El HTML de `/berry/tasks` (ver código fuente) debe contener la cabecera "Tasks" y el shell. El LCP en Lighthouse debe bajar.

---

## 2. Lista de tareas: render caro y repetido

**Qué pasa.**

- Cada fila es un `motion.div` ([issue-line.tsx:77](../../frontend/components/common/issues/issue-line.tsx:77)) envuelto en `useDrag` de react-dnd ([issue-line.tsx:175](../../frontend/components/common/issues/issue-line.tsx:175)). Las columnas del board usan `AnimatePresence` + `motion.div` ([board-column.tsx:105](../../frontend/components/common/board-column.tsx:105)).
- No hay virtualización: se montan todas las filas.
- Las tareas llegan por páginas de 100 ([lib/issues.ts:278](../../frontend/lib/issues.ts:278)). En la carga inicial, cada página se fusiona en el store (`onPage`, [issues.ts:312](../../frontend/lib/issues.ts:312)) y al final se hace `hydrateIssues(all)`. Resultado: un render completo de la lista por cada página, más otro al final.

**Evidencia.** `/berry/tasks` con solo **150 tareas**, sin throttling:

- Long tasks de **447 ms** (al llegar la página 1) y **372 ms** (al llegar la página 2), más otras 3 menores.
- **TBT ≈ 786 ms** y unos 1 040 ms de long tasks en total.
- **4 789 nodos DOM**, unos 30 por fila. Lighthouse marca "DOM excesivo" a partir de unos 1 400.
- Con CPU 4× eso supera los 3 s de TBT: puntuación TBT en 0. Escala con el número de tareas (`MAX_PAGES = 20`, hasta 2 000).

**Opciones:**

- Virtualizar la lista y el board (por ejemplo `@tanstack/react-virtual`). Este es el mayor ahorro de TBT y DOM.
- Quitar `motion` de la fila: usar CSS o `layoutId` solo en la fila que se mueve, o `LazyMotion` + `m` con `domAnimation`.
- Montar `useDrag` solo al interactuar (pointerdown/hover) o usar un wrapper ligero, en lugar de registrar el drag en cada fila al montar.
- No re-renderizar la lista por cada página: pintar la primera página y fusionar el resto en un solo `set`, o dentro de `startTransition`.

**Cómo verificar.** Con 150 o más tareas, las long tasks de la carga deben quedar por debajo de unos 100 ms sin throttling, y el DOM por debajo de unos 1 500 nodos.

---

## 3. Cada ruta hidrata el workspace entero

**Qué pasa.** [useHydrateWorkspaceData](../../frontend/hooks/use-hydrate-workspace-data.ts:43) corre en el shell y, en **cualquier** ruta, carga:

- todas las tareas del board, paginando hasta 2 000 ([línea 85](../../frontend/hooks/use-hydrate-workspace-data.ts:85));
- los runs del board (200);
- miembros, proyectos, inbox, agentes, labels, vistas, milestones, ciclos, approvals, reviews y pins;
- y abre 2 streams SSE.

Además, [use-board-event-stream.ts:138](../../frontend/hooks/use-board-event-stream.ts:138) vuelve a descargar **todas** las tareas cuando llegan ciertos eventos.

**Evidencia** (prod):

| Ruta | Peticiones API en el arranque |
|------|-------------------------------|
| `/berry/tasks` | 21 (`issue-properties` ×3) |
| `/berry/projects` | 18 (`projects` ×2) |
| `/berry/agents` | 24 (`agents` ×3, `config` ×2) |
| `/berry/inbox` | 18 (`inbox` ×2) |
| `/berry/issue/BER-144` | **45**: la lista completa de tareas ×3–4, `reviews` ×3, `attachments` ×2, `members` ×2, `runs` ×2, `milestones`/`cycles`/`pins` ×2 |

Todas esas respuestas se parsean con zod y se meten en stores, y cada `set` provoca renders. Es CPU en el arranque (TBT) y compite por la red con lo que la página necesita.

**Opciones:**

- Cargar por ruta: Inbox solo necesita el inbox y el contador; Projects, los proyectos. La lista completa de tareas solo hace falta en Tasks, My tasks y vistas, no en el detalle de una tarea ni en Agents.
- Diferir lo que no se ve: approvals, milestones, cycles y views pueden esperar a `requestIdleCallback` o a que se abra el selector que los usa.
- Deduplicar: hay peticiones idénticas en vuelo al mismo tiempo. El patrón `inFlight` ya existe en `lib/issues.ts` y se puede generalizar en `apiFetch` para los GET.
- Revisar qué eventos SSE disparan `refreshIssues` y cambiarlo por una actualización por id (ya existe `refetchIssues(issueIds)`).

---

## 4. Demasiado JS inicial en cada ruta de la app

**Qué pasa.** Todas las rutas del workspace comparten unos 28 chunks. Las cifras son de JS cargado en el arranque, en producción:

| Ruta | Archivos JS | Raw | Gzip (aprox.) |
|------|-------------|-----|---------------|
| `/sign-in` | 14 | 758 KB | 227 KB |
| `/berry/tasks` | 35 | 1 641 KB | 502 KB |
| `/berry/inbox` | 38 | 1 774 KB | ~540 KB |
| `/berry/issue/[id]` | 36 | 2 115 KB | ~690 KB |

Composición del inicial de `/berry/tasks` según `next analyze` (raw / comprimido):

| Paquete o carpeta | Tamaño | Comentario |
|-------------------|--------|------------|
| `next` (incluye react-dom) | 447 / 169 KB | Base, inevitable |
| `zod` clásico | 106 / 34 KB | `zod/mini` es mucho más pequeño |
| `motion-dom` + `framer-motion` | 128 / 61 KB | Solo se usa en `issue-line`, `board-column` y `segment-indicator`; ver punto 2 |
| `lucide-react` | 37 / 24 KB | 122 iconos |
| `sonner`, `tailwind-merge`, `date-fns` | ~80 KB raw | |
| react-dnd (+ html5 backend + dnd-core) | ~42 KB raw | En todas las rutas |
| Command palette, chat flotante, `CreateWorkspaceDialog` | ~60 KB raw | Montados siempre en [app/[orgId]/layout.tsx](../../frontend/app/[orgId]/layout.tsx) aunque no se abran |
| better-auth + better-fetch | 24 KB raw | Cliente de auth en todas las rutas |

Detalle de tarea:

- **Tiptap/ProseMirror (564 KB raw / 187 KB gzip)** se pide a los ~700 ms, nada más hidratar, solo para mostrar la descripción. Ya es `dynamic()` ([tiptap-ai-editor-lazy.tsx:25](../../frontend/components/common/editor/tiptap-ai-editor-lazy.tsx:25)), pero se monta enseguida.
- [integration-logos.tsx](../../frontend/components/common/settings/integration-logos.tsx) (**86 KB raw**, un único objeto con todos los SVG) entra por [runtime-provider-badge.tsx:2](../../frontend/components/common/runtimes/runtime-provider-badge.tsx:2) para pintar un solo logo.

**Opciones:**

- Detalle de tarea: pintar la descripción en solo lectura (texto o markdown ligero) y cargar Tiptap al hacer foco o clic en editar.
- `integration-logos`: un módulo por logo, o un mapa de imports dinámicos.
- Cargar bajo demanda la command palette (al pulsar ⌘K), el chat flotante (al abrirlo) y `CreateWorkspaceDialog` (al abrirlo).
- `motion`: `LazyMotion` + `m` + `domAnimation`, o CSS.
- Valorar `zod/mini` para los esquemas de `lib/`, que se parsean en cada respuesta. El cambio es grande; medir antes.

---

## 5. Catálogo i18n completo en cada HTML

**Qué pasa.** [i18n/request.ts](../../frontend/i18n/request.ts) carga los 20 namespaces y `<NextIntlClientProvider>` ([app/layout.tsx:94](../../frontend/app/layout.tsx:94)), sin la prop `messages`, los pasa **todos** al cliente.

**Evidencia:**

- Catálogo minificado: 133 KB (40 KB gzip).
- De los 162 KB del HTML de `/sign-in`, 159 KB son payload RSC, casi todo mensajes.
- Pasa en todas las rutas, incluida `/sign-in`, que usa una fracción mínima.
- Los namespaces más grandes son `loops` (22 KB), `workspaceAdmin`, `issueDetail`, `areas` y `agentsChat`.

Ese payload se descarga antes de que el HTML termine y se parsea en la hidratación.

**Opciones.** Pasar a `NextIntlClientProvider` solo los namespaces del shell y común (`messages={pick(messages, [...])}`), y anidar providers con los namespaces de cada sección en sus layouts (`app/[orgId]/loops/layout.tsx`, etc.). Otra opción es traducir en componentes de servidor donde se pueda.

---

## 6. Fuentes demasiado pesadas y precargadas en todas las páginas

**Qué pasa.** [app/layout.tsx:14–35](../../frontend/app/layout.tsx:14) precarga `inter-variable-latin.woff2` (**206 KB**) y `jetbrains-mono-variable-latin.woff2` (46 KB) en todas las rutas. Los preloads de fuente van con prioridad alta y compiten con el JS crítico. Con unos 1.6 Mbps, 252 KB son más de un segundo de banda. Según el comentario del layout, el subset conserva todos los ejes variables y **todas** las features OpenType (`--layout-features='*'`). Un Inter latin solo con el eje `wght` y las features básicas pesa unos 50–70 KB.

**Opciones:**

- Volver a subsetear Inter con solo el eje `wght` y las features que se usen (por ejemplo `kern,liga,calt,tnum,ss0x`, si se usan).
- `preload: false` en JetBrains Mono si no aparece en el primer pantallazo, o dejar solo el preload de Inter.

---

## 7. Prefetch agresivo de rutas dinámicas

**Qué pasa.** Al arrancar se lanzan 15–22 peticiones `?_rsc=` a `/berry/inbox`, `reviews`, `projects`, `cycles`, `loops`, `agents`, `skills` y `tasks?tab=assigned`, cada una dos veces (dos hashes de `_rsc`). Son rutas dinámicas: cada prefetch ejecuta el layout en el servidor (cookies, locale, catálogo).

**Opciones.** `prefetch={false}` en los enlaces del rail (el `loading.tsx` ya da feedback inmediato), o prefetch al pasar el ratón por encima.

---

## 8. CSS global único

**Qué pasa.** Una sola hoja de 214 KB raw / 33 KB gzip ([app/globals.css](../../frontend/app/globals.css), 1 714 líneas más Tailwind) bloquea el render en todas las rutas. Incluye los estilos de editores (`.ProseMirror`, `.cm-*`, `.tiptap-ai-editor`: unas 160 reglas) que solo se usan en vistas concretas.

**Opciones.** Es la prioridad más baja de la lista. Mover los estilos de editores a CSS importado por esos componentes, que ya se cargan con `dynamic()`. Lighthouse mostrará "Reduce unused CSS", pero el impacto en la puntuación es pequeño comparado con los puntos 1–4.

---

## 9. `/sign-in`: el formulario llega tras varias rondas

**Qué pasa.** Si el 37 sale de `/sign-in`, el flujo es este:

1. HTML (boot screen).
2. JS: 227 KB gzip.
3. `/me/bootstrap` + `/boards` (401).
4. Con `NEXT_PUBLIC_AUTO_LOGIN_EMAIL`, además `dev-login`.
5. Se monta la página y se pide `/api/v1/config` ([sign-in/page.tsx:181](../../frontend/app/sign-in/page.tsx:181)).
6. Mientras `options === null` se pinta un `div` vacío ([sign-in/page.tsx:208](../../frontend/app/sign-in/page.tsx:208)).
7. Por fin, el formulario.

El H1 depende de tres rondas de red más la hidratación. Además, una visita anónima pide `/api/v1/boards`, que no le sirve de nada.

**Opciones:**

- Resolver las opciones de sign-in en el servidor (es una página estática por despliegue) y pintar el formulario en SSR.
- Que `SessionGate` no bloquee las rutas de auth en `booting`: mostrar el formulario y redirigir si resulta que hay sesión.
- No pedir `boards` sin sesión: hacerlo después de que bootstrap responda 200.

---

## Otros hallazgos (no son de rendimiento)

- `newIdempotencyKey()` ([lib/api-schemas.ts:24](../../frontend/lib/api-schemas.ts:24)) usa `crypto.randomUUID()`, que **no existe en orígenes no seguros**. Al abrir la app por `http://<IP-LAN>:3000`, por ejemplo desde un móvil, crear tareas y otras mutaciones lanza `TypeError`. Un fallback con `crypto.getRandomValues` lo resuelve.

## Datos crudos

- Bundle analyzer: `frontend/.next-verify/diagnostics/analyze`. Para verlo en local: `cd frontend && NEXT_DIST_DIR=.next-verify node node_modules/next/dist/bin/next analyze` (pasar `--port` si 4000 está ocupado por la API).
- Exportar el grafo de una ruta: `next analyze export --dist-dir .next-verify --route "/[orgId]/tasks"`.
