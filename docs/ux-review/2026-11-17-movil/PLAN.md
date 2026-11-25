# Plan de arreglo de la versión móvil, por fases

> Sale del análisis de [README.md](README.md) (primera pasada y validación). No se ha cambiado código.

## Cómo se ejecuta

- Una tarea = un subagente = un commit, en serie, con una puerta de verificación entre tarea y tarea (protocolo del orquestador de subagentes).
- Cada tarea lista los archivos que puede tocar. Lo que salga de esa lista se reporta y no se arregla de paso.
- **Rama:** pendiente de elegir (ver D0). Commits con el formato `fix(frontend): … (BERR-NN)`.
- **Puerta por tarea:**
  1. `cd frontend && bunx eslint <archivos tocados>` (solo lo tocado).
  2. La medición de la tarea con los scripts de [`scripts/`](scripts/), contra el servidor de prueba (`:3100` web y `:4100` API, base de datos de prueba), a 390×844 y 360×780. Las tareas de navegación también se miden a 820×1180.
  3. Captura antes/después en light y dark.
- **Puerta por fase:** `cd frontend && bun run build:check`, y otra pasada completa de `mobile-audit2.cjs` a 390 y 320, que no puede empeorar en ninguna ruta.
- **Regla general de las tareas:**
  - Lo que cambie por debajo de `sm`/`md`/`lg` no puede mover nada a partir de `lg`; el escritorio queda igual (se comprueba con una captura a 1440).
  - Para mostrar en táctil lo que hoy es solo hover, se usa el patrón que ya existe en `issue-quick-actions.tsx:115` (`[@media(hover:hover)]:…`).

## Decisiones antes de empezar

| # | Decisión | Opciones | Afecta a |
| --- | --- | --- | --- |
| D0 | Rama de trabajo | Nueva desde `main` (recomendado: un PR solo de móvil) · seguir en `perf/boot-realtime` | Todo |
| D1 | Navegación en el teléfono | **Decidido (2026-11-17): b)**, barra inferior completa. El usuario quiere verla y no le gusta el botón flotante. (Opciones eran: a) menú flotante completado; b) barra inferior con 4–5 destinos + "Más") | M1.4, M4.1 |
| D2 | Tablet (768–1023 px) | **Decidido (2026-11-18): rail fijo a partir de `md`.** (Opciones eran: rail fijo a partir de `md` · igual que el teléfono) | M4.2 |
| D3 | Mover tareas en el tablero con el dedo | **Decidido (2026-11-18): solo "Mover a…" en el menú de la tarjeta.** (Opciones eran: backend táctil de react-dnd · solo "Mover a…") | M4.5 |
| D4 | Chat en light | Sigue oscuro o pasa al tema (pendiente desde §6.5.1 de la revisión light/dark) | M3.9 |

## Fase 1 — Desbloquear (🔴)

Objetivo: que todo lo que hoy no se puede hacer en un teléfono se pueda hacer. Sin rediseños.

| ID | Tarea | Alcance (archivos) | Hecho cuando | Depende de |
| --- | --- | --- | --- | --- |
| M1.1 | El composer del chat flotante queda libre de los botones flotantes | `components/common/chat/floating-chat.tsx`, `components/layout/shell/shell-chat-button.tsx`, `components/layout/shell/berry-shell.tsx` | A 390 y 360, `elementFromPoint` en el centro de **Send** y del selector "Agent" devuelve el propio botón, también con el teclado abierto (viewport 390×508) | — |
| M1.2 | Botón × en los drawers de detalle por debajo de `lg` | `components/layout/detail-drawer-shell.tsx` (+ el header de cada drawer si el × debe ir dentro: `components/layout/headers/issue/header.tsx`) | Tarea, proyecto, agente, plan, skill, vista, hito y perfil muestran un × de 44 px que vuelve a la lista. El de ciclo no duplica el suyo | — |
| M1.3 | Abrir la búsqueda/paleta sin teclado | `components/layout/command-palette.tsx`, nuevo `store/command-palette-store.ts`, `components/layout/shell/shell-rail.tsx` | El menú del teléfono tiene "Search" arriba y abre la paleta. ⌘K sigue funcionando en escritorio | — |
| M1.4 | **Barra inferior completa** (D1 = b; adelanta la parte b de M4.1) | `components/layout/shell/berry-shell.tsx`, `shell-rail.tsx`, `shell-chat-button.tsx` y un componente nuevo de barra | Por debajo de `lg`, una barra fija abajo con 4 destinos + "Más" sustituye al botón flotante del menú. "Más" abre la hoja con todas las secciones (incluidas Chat, Plans, Runs, Views y Settings) y Search arriba. No tapa contenido ni el composer del chat. Respeta `safe-area-inset-bottom`. Escritorio igual | D1 |
| M1.5 | Filas de "añadir" de Settings que se salen | `components/common/settings/join-links-settings.tsx`, `components/common/settings/account-connections.tsx` | "Create link" y "Add" están dentro del viewport y se pueden tocar a 360 | — |
| M1.6 | Footer del diálogo de nuevo proyecto | `components/common/projects/create-project-dialog.tsx`, `components/common/projects/create-project/agent-draft-panel.tsx` | A 360 los dos botones se ven enteros (apilados por debajo de `sm`). El panel del agente (`w-[400px]`) se abre a pantalla completa en el teléfono | — |
| M1.7 | Chips de vistas fijadas alcanzables | `components/common/views/saved-views-bar.tsx` | Las cinco vistas y "Manage views" se pueden tocar a 390 y 360: scroll lateral con pista visual, o las que no caben pasan al menú de desborde que ya existe. A 1440 el "New view" de la fila tampoco se sale (hoy termina en x = 1487) | — |
| M1.8 | Encabezado de página que se dobla o se compacta | `components/common/page/page-parts.tsx` (`PageKpiHeader`, línea 210) | Por debajo de `sm`, el botón principal cabe entero o pasa a solo icono con `aria-label`. Medido en Cycles, Loops, Agents y Skills a 360 | — |
| M1.9 | Selección múltiple en táctil | `components/common/issues/selection-checkbox.tsx`, `components/common/issues/batch-toolbar.tsx:144` | En `(hover: none)` el checkbox se ve (hoy tiene opacidad 0) y se puede tocar con al menos 24 px de zona activa. La barra de acciones en bloque cabe a 360: hoy es una sola fila y Assignee, AutoGate, Delete y Clear se salen por la derecha (x 350–692) | — |
| M1.10 | Panel de valores del filtro dentro de la pantalla | `components/data-table-filter/components/filter-selector.tsx:119` | Por debajo de `sm`, el panel de valores sustituye a la lista de campos (con "← atrás") o se abre debajo, en vez de `left-full`. A 360, las etiquetas de Status, Assignee, Priority y Labels se leen enteras | — |
| M1.11 | Paleta usable con el teclado en el teléfono | `components/layout/command-palette.tsx` (y su `DialogContent`/`CommandDialog`) | *Del teléfono real.* Por debajo de `sm`, la paleta se ancla arriba (no centrada), así que con el teclado abierto se ven al menos 6 resultados. La pista "Ctrl+Enter opens in a new tab" no se pinta encima del placeholder, y no se muestra, igual que los chips de atajos, en `(hover: none)` | M1.3 |

## Fase 2 — Causas raíz de layout (🟠)

| ID | Tarea | Alcance | Hecho cuando | Depende de |
| --- | --- | --- | --- | --- |
| M2.1 | Barras de filtros sin altura fija | `components/common/projects/projects.tsx:322`, `components/layout/headers/agents/header-options.tsx:56`, `components/common/logs/prompt-logs.tsx:110` | `h-[48px]` pasa a `min-h-[48px]`. A 390 la segunda línea no tapa la tabla en Projects, Agents ni Logs | — |
| M2.2 | Settings se apila en el teléfono | `components/common/settings/shared.tsx` (`SettingsShell` línea 53, `SettingsRow` línea 184) | Por debajo de `sm`: `px-4` en vez de `px-8`, y etiqueta y control apilados. Ninguna descripción queda con una palabra por línea en las 19 páginas de Settings | — |
| M2.3 | Encabezado de Settings | `components/layout/headers/settings/header.tsx`, `header-nav.tsx` | Sin nombre repetido en el teléfono, el selector con elipsis, y Organization y Repositories con su nombre | M2.2 |
| M2.4 | Filas de Members | `components/common/members/members.tsx` | Nombre y correo en una línea cada uno. El rol y Remove van debajo o en un menú por debajo de `sm` | M2.2 |
| M2.5 | Tabla de Logs | `components/common/logs/prompt-logs.tsx` | Por debajo de `md`, filas en tarjeta (o scroll lateral con la primera columna fija). Se lee WHEN, PURPOSE, MODEL y estado sin scroll a 390 | M2.1 |
| M2.6 | Controles que solo aparecen con hover | `cycles/cycle-detail.tsx:410`, `projects/details/project-milestones-section.tsx:273,325`, `issues/details/issue-relations.tsx:205`, `loops/loop-card.tsx:97`, `views/saved-views-bar.tsx:210`, `chat/chat-sessions.tsx:151`, `chat/chat-thread.tsx:215,238`, `issues/details/file-list.tsx:80`, `issues/details/preview-panel.tsx:859`, `layout/shell/shell-pins.tsx:180,213`, `projects/create-project/date-selector.tsx:119`, `issues/insights-panel.tsx:236` | En `(hover: none)` todos se ven (medido: ningún control con opacidad efectiva 0 en Tasks, drawer de tarea, Loops, Views, Chat, drawer de ciclo, drawer de proyecto y menú) | M1.9 (mismo patrón) |
| M2.7 | Paneles que no existen en el teléfono pero sí su botón | `components/layout/headers/profile/header.tsx`, `components/common/members/member-profile.tsx:202,209`, `components/common/projects/details/project-side-panel.tsx:36` | En el perfil de un miembro, Insights y Perfil se abren como overlay por debajo de `lg` (como ya hace `all-issues.tsx:90` con `absolute inset-0 … lg:static`) o sus botones se ocultan. El panel de propiedades/insights del proyecto (`hidden xl:flex`) se alcanza por debajo de `xl` | — |

## Fase 3 — Filas de lista, drawers y chat (🟠)

| ID | Tarea | Alcance | Hecho cuando | Depende de |
| --- | --- | --- | --- | --- |
| M3.1 | Fila de tarea: el título primero | `components/common/issues/issue-line.tsx:148` | Por debajo de `sm`, el responsable es solo avatar. Con nombres largos, el título muestra al menos 20 caracteres a 390 | — |
| M3.2 | Runs en tarjetas | `components/common/runs/run-overview.tsx:247-253` | Por debajo de `md`, sin `table-fixed` ni columnas de 120/200 px. A 320 no se pisan ni el encabezado ni las filas (hoy "ASSIGNEE" se pinta encima de "ISSUE") | — |
| M3.3 | Fila de vista | `components/common/views/views.tsx` | El dueño es avatar y el nombre de la vista cabe a 390 | — |
| M3.4 | Loops: KPIs y "need attention" | `components/common/loops/loops.tsx`, `loop-card.tsx` | KPIs en dos filas o con scroll con pista. Los nombres en "need attention" muestran al menos 15 caracteres | M1.8 |
| M3.5 | Cycles: columnas de estado y línea de tiempo | `components/common/cycles/cycle-visuals.tsx`, `cycle-timeline.tsx`, `cycle-group.tsx` | "Done / In progress / Not started" separados. La línea de tiempo y la tabla tienen scroll con pista o una vista compacta por debajo de `sm` | — |
| M3.6 | Drawer de tarea | `components/layout/headers/issue/header.tsx`, `components/common/issues/details/sub-issues.tsx`, `components/common/issues/details/run-console.tsx` | El breadcrumb no parte "No project". La fila de sub-tareas no se dobla rara. "Console" no tapa la actividad | M1.2 |
| M3.7 | Drawer de ciclo | `components/common/cycles/cycle-detail.tsx` | Remove y Activate pasan a un menú en el teléfono y el breadcrumb se lee. Los controles miden al menos 24 px | M1.2 |
| M3.8 | Drawer de agente | `components/common/agents/agent-details.tsx`, `agent-overview-tab.tsx`, `agent-tier-section.tsx` | El aviso de runtime se dobla, las pestañas muestran que hay más, y los tiers dicen su nombre | M1.2 |
| M3.9 | Texto del chat | `components/common/chat/chat-thread.tsx` | Las respuestas del agente pasan de 12 px a 14–16 px. Tema según D4 | D4 |

## Fase 4 — Navegación y plataforma

| ID | Tarea | Alcance | Hecho cuando | Depende de |
| --- | --- | --- | --- | --- |
| M4.1 | Navegación del teléfono según D1 | `components/layout/shell/berry-shell.tsx`, `shell-rail.tsx`, `shell-chat-button.tsx` | a) El launcher no brilla encima del velo del menú. b) La barra inferior lleva los destinos principales y "Más", sin tapar contenido | D1, M1.4 |
| M4.2 | Rail fijo en tablet | `hooks/use-mobile.ts`, `components/layout/shell/berry-shell.tsx`, `components/common/page/split-index.tsx` | A 820 el rail está fijo, sin menú flotante ni franja de 48 px. El teléfono no cambia | D2 |
| M4.3 | Safe areas y marco simétrico | `app/layout.tsx` (export `viewport` con `viewportFit: 'cover'` y `themeColor`), `app/globals.css:1011-1014` | Botones flotantes y bordes respetan `env(safe-area-inset-*)`. Márgenes iguales a izquierda y derecha en el teléfono | — |
| M4.4 | Teclado virtual | `app/layout.tsx` (`interactiveWidget: 'resizes-content'` en el export `viewport`), `components/common/loops/new-loop.tsx`, el diálogo de nueva tarea (`components/layout/sidebar/create-new-issue/index.tsx`) | *Confirmado en Android real:* Chrome no reduce el layout viewport, y "Draft loop" y "Create task" quedan debajo del teclado. Hecho cuando, en el teléfono con el teclado abierto, esos dos botones y el Send de los chats se ven y se pueden tocar. El título de nueva tarea lleva `enterKeyHint`/`autoComplete` adecuados (sin barra de autocompletar de Chrome). Falta probar en iPhone | M1.1 |
| M4.5 | Mover tareas con el dedo según D3 (*confirmado en Android real: no hay `dragstart`*) | `components/common/issues/grouped-issues-view.tsx`, `components/common/projects/projects-board.tsx`, `components/common/issues/issue-grid.tsx` | En el tablero se puede mover una tarjeta de columna con el dedo (D3 = backend táctil) o con "Mover a…" desde la tarjeta. El scroll lateral del tablero sigue funcionando | D3 |
| M4.6 | Indicador de Next en desarrollo | `next.config.ts` (`devIndicators`) | El indicador no tapa el botón de menú en `next dev`. Solo afecta al desarrollo | — |

## Fase 5 — Pulido (🟡)

| ID | Tarea | Alcance | Hecho cuando |
| --- | --- | --- | --- |
| M5.1 | Objetivos táctiles de al menos 24 px | checkbox de fila, iconos de borrar en `issue-labels-settings.tsx` y `skill-labels-settings.tsx`, manijas en `model-tiers-settings.tsx`, catálogos | Cada pantalla de la tabla 🟡 del README baja al menos un 80 % sus controles menores de 24 px |
| M5.2 | Reviews legible | `components/common/reviews/reviews.tsx`, `review-overview.tsx` | Sin `break-all` (pasa a `break-words`) y filas a 14 px |
| M5.3 | Inbox sin identificador duplicado | `components/common/inbox/inbox-row.tsx` | "BER-516" aparece una vez |
| M5.4 | Títulos que faltan | `components/layout/headers/plans/header.tsx`, `components/common/agents/agent-catalog.tsx` | Plans y Agent catalog tienen título, y el catálogo tiene vuelta atrás |
| M5.5 | Placeholders y nombres cortados | buscadores de catálogo e integraciones, `model-tiers-settings.tsx` | Sin placeholders cortados a 360, y el nombre del tier completo |
| M5.6 | Pistas de teclado en táctil | `components/common/loops/new-loop.tsx` (`composerHint`), `create-plan-dialog.tsx`, `create-milestone-dialog.tsx`, `components/common/issues/issue-context-menu.tsx` (⌘ L, ⌘ ⌫) | En `(hover: none)` no se muestran "⌘↵" ni los atajos del menú contextual. El menú contextual, abierto con long-press en Android, deja margen con el borde derecho |
| M5.7 | Edición del título en la vista de tabla | `components/common/issues/issue-table.tsx:197` | El doble clic tiene una alternativa táctil, o se documenta que en el teléfono se edita en el drawer |
| M5.8 | Sign-in en el teléfono | `components/auth/auth-card.tsx`, la página de sign-in | Sin la franja clara de 8 px arriba, y el logo se ve sobre el fondo oscuro |

## Fase 6 — Transversal (lo encontró la validación, pero no es solo del móvil)

Se pueden hacer antes, después o en otra rama: no dependen del resto del plan.

| ID | Tarea | Alcance | Hecho cuando |
| --- | --- | --- | --- |
| M6.1 | Volver al destino después de iniciar sesión | `components/layout/session-gate.tsx:87`, `lib/auth.ts` (`callbackURL` en 90, 154, 169 y 180), la página de sign-in | Abrir `/berry/issue/BER-511` sin sesión, entrar, y aterrizar en esa tarea. Solo rutas internas (sin redirecciones abiertas) |
| M6.2 | Que un error no se vea como lista vacía | `components/common/issues/` (la vista que pinta "No tasks yet") y el store que la alimenta | Con la API de tareas en 500, Tasks muestra un error con "Try again", no "Create the first task" |
| M6.3 | Proyecto inexistente | la página/drawer de proyecto (`app/[orgId]/project/…`, `@drawer/(.)project/…`) | Un id que no existe muestra "no encontrado" con vuelta a Projects, como ya hace la tarea ("Task unavailable") |
| M6.4 | Arranque en red lenta | `components/layout/session-gate.tsx`, `store/session-store.ts` | Con 2,5 s de latencia por llamada, hoy "Loading Berry" dura más de 8 s porque las llamadas del arranque van en cadena. Medir cuántas son y paralelizar lo que se pueda (encaja con la rama `perf/boot-realtime`) |
| M6.5 | Navegar sin conexión | navegación cliente / service worker (por decidir) | Sin red, tocar una tarea no saca de la app a la página de error del navegador. Como mínimo, un aviso de "sin conexión" |

## Orden y tamaño

- **Fase 1:** once tareas pequeñas, independientes entre sí salvo M1.4 (D1) y M1.11 (después de M1.3). Es lo que más cambia la experiencia. **Empezar aquí.**
- **Estado (rama local `fix/mobile`, 2026-11-17):** Fase 1 completa en código y verificada en emulación (390/360/320/820/1440). Commits: M1.1 `50e12b9a`, M1.2 `35b93322`, M1.3 `4c767b5a`, M1.5 `58dee1e5`, M1.6 `2671144f`, M1.7 `6a5b9541`+`5fca117a`, M1.8 `d2a0bc87`, M1.9 `fc19a594`, M1.10 `24a2cec2`+`49ff2bb7`, M1.11 `63f1b84e`, M1.4 (barra inferior, D1 = b) `57cff601`+`038f37cf`+`02397771`; y M0.1 `bee2a350` (`BERRY_DEV_ORIGINS` para abrir `next dev` desde el iPhone). Falta la prueba en el Android real y la revisión del usuario.
- **Fase 2:** siete tareas. Corrige de una vez muchas pantallas, sobre todo Settings y los controles que solo aparecen con hover.
- **Fase 3:** nueve tareas de pantalla concreta.
- **Fase 4:** necesita las decisiones D1–D3 y probar en teléfonos reales (teclado, safe areas, arrastre). **Estado (2026-11-18):** completa en código (`86d0de5b`, `3aea1d72`, `de634841`, `40edc4e7`, `8975305b`; M4.1 y M4.6 sin cambio). Falta la prueba en teléfonos reales y la revisión del usuario.
- **Fase 5:** se puede repartir cuando sobre tiempo. **Estado (2026-11-18):** completa (`ccd41395`, `58b7a33a`+`47be108b`, `1f10d6ac`, `b519dc9d`, `fef04a3e`, `2d54c6e3`, `181a143c`, `64c702e3`). Falta la revisión del usuario.
- **Fase 6:** va aparte del móvil. M6.1 y M6.2 son las que más afectan a quien usa Berry desde el teléfono.
