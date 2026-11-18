# Revisión de la versión móvil — 2026-11-17

> Solo análisis: no se cambió código.
>
> - **Validado** el mismo día con una segunda pasada (§ Validación). Se volvieron a medir los bloqueos y se cubrieron los huecos de la primera.
> - **Plan de trabajo** por fases y tareas: [PLAN.md](PLAN.md).

- **Rama:** `perf/boot-realtime` @ `ae4bcea3`
- **Entorno:** web de prueba en `localhost:3100` y API de prueba en `:4100`, con la base de datos de prueba (nunca la de desarrollo).
- **Dispositivos emulados:**
  - 390×844 (iPhone 12–15), con `isMobile`, `hasTouch` y user agent de iOS Safari.
  - Pasada extra a 360×780 (Android pequeño) y a 820×1180 (tablet).
- **Capturas:** en esta carpeta.
  - Las parejas llevan light a la izquierda y dark a la derecha, y salen reducidas al ~80 %.
  - Las sueltas (13–17) están a escala real.
  - En las parejas aparece la píldora naranja "1 Insight": es el indicador de `next dev`, no de la app.

## Resumen

La versión móvil **se usa para leer, pero no para trabajar.** No hay ninguna página que se desplace de lado entera. Tampoco hay zoom al escribir, el menú funciona y el diálogo de nueva tarea está bien. Lo que rompe la experiencia son ocho patrones que se repiten:

1. **Hay acciones inalcanzables.**
   - En el chat flotante, el launcher Agents tapa el botón **Send**: en el teléfono no se puede enviar.
   - "Create link" (Members) y "Add" (Connected accounts) quedan fuera de su grupo.
   - "Create with agent" (nuevo proyecto) se sale por la izquierda.
   - En Views, tres de los cinco chips de vistas fijadas no se ven.
2. **No hay forma de cerrar los drawers de tarea, proyecto y agente.** Ocupan toda la pantalla y no tienen ×; en escritorio se cierran tocando fuera.
3. **Los encabezados de página no caben.** El botón principal ("New cycle", "New loop", "New agent", "New skill") se corta en el borde derecho.
4. **Las barras de filtros se doblan y quedan escondidas** debajo del contenido (Projects, Agents, Logs).
5. **Las filas reparten mal el ancho.** El dato secundario (responsable, dueño, rol, columnas fijas de tabla) se queda con el espacio y el título se reduce a 3–8 letras: Tasks, Runs, Views, Loops, ciclo, Members.
6. **Settings no se adapta.** Etiqueta y control van siempre lado a lado, con 48 px de margen por lado, y las descripciones quedan con una palabra por línea.
7. **No hay búsqueda ni paleta de comandos en el teléfono.** La paleta solo se abre con ⌘K y el menú no tiene buscador.
8. **Lo que en escritorio aparece con hover, en el teléfono no existe** (encontrado en la validación):
   - el checkbox de selección de las filas (opacidad 0), así que no hay selección múltiple ni acciones en bloque;
   - el "⋯" de las tarjetas de Loop;
   - las acciones de los mensajes del chat;
   - borrar relaciones, hitos y archivos.

La mayoría sale de **unos pocos componentes compartidos** (ver Causas raíz). Arreglarlos corrige muchas pantallas a la vez.

## Hallazgos por gravedad

### 🔴 Bloquean una tarea

| # | Dónde | Qué pasa | Evidencia |
| --- | --- | --- | --- |
| 1 | Chat flotante (botón Agents) | Por debajo de `sm`, la ventana ocupa hasta el borde inferior (`floating-chat.tsx:350`: `inset-x-0 … bottom-0`). Encima quedan el launcher (z-45) y el botón de menú (z-50). Medido: en el centro del botón **Send** (332–364 × 782–814), quien recibe el toque es "Close Agents". El botón de menú tapa además el selector "Agent" del composer. | `13-chat-flotante-send-tapado.png` |
| 2 | Drawer de tarea, proyecto y agente | No hay botón de cerrar. El header de la tarea solo tiene ↑ ↓ y "⋯". Por debajo de `lg` el drawer mide el 100 % del ancho (`detail-drawer-shell.tsx:52-57`), así que no hay "fuera" que tocar. Solo queda el gesto atrás o el breadcrumb. El de ciclo sí tiene × (`DetailHeader`). | `11-drawer-tarea-sin-cerrar.png`, `12-drawer-agente.png` |
| 3 | Búsqueda / paleta | El estado de la paleta es un `useState` local (`command-palette.tsx:300`) y solo se abre con el atajo. El menú del teléfono no tiene buscador. Desde el menú tampoco se llega a Chat, Plans, Runs, Views ni Settings (Settings vive en el menú del workspace). | `15-menu-sin-buscador.png` |
| 4 | Settings → Members | La fila "New link" (Member, Expires in 7 days, Create link) mide 408 px y se sale del grupo, que la recorta: "Create link" no se ve. | `06-settings-members.png` |
| 5 | Settings → Connected accounts | La fila "Add an address" se sale del grupo: el campo queda cortado y "Add" no se ve. El correo se mete debajo de "Remove". | `08-connected-accounts.png` |
| 6 | Nuevo proyecto | El footer es una sola fila (`create-project-dialog.tsx:383`, `flex-row … justify-end`). Con "Create with agent" y "Create project" no cabe, y el primero empieza en x = −23. | `14-nuevo-proyecto-boton-fuera.png` |
| 7 | Views | La fila de vistas fijadas va con `overflow: hidden`, sin scroll. Quedan fuera de alcance "Open bugs", "Urgent and high" y "Waiting for review". La validación encontró que también quedan fuera **"Manage views"** y el "New view" de esa fila (x = 980–1255). Se puede crear una vista porque hay otro "New view" más abajo (207–324 × 197–225), pero "Manage views" no tiene otro camino. *Además, en escritorio a 1440 px ese "New view" de la fila también se sale (termina en x = 1487).* | `10-views.png` |
| 8 | Encabezados de Cycles, Agents y Skills (y Loops a 360) | El botón principal se corta en el borde derecho: en Agents termina en x = 412 sobre un viewport de 390, en Cycles en 406 y en Skills en 393. "New loop" cabe por poco a 390 (termina en 387) y se corta a 360. A 360 px desaparece casi entero. | `01-encabezado-boton-cortado.png` |
| 9 | Solo en desarrollo | El indicador de Next ("1 Insight") se pone encima del botón de menú e intercepta el toque: la prueba automática no podía abrir el menú. No llega a producción, pero estorba al probar en el teléfono con `next dev`. | cualquier pareja |
| 10 | Selección múltiple (Tasks, tablero, listas de tareas) | *Encontrado en la validación.* El checkbox de fila solo se ve con hover (`selection-checkbox.tsx:41`: `opacity-0 group-hover:opacity-100`). Medido en el teléfono: opacidad 0, 14×14 px. Se puede tocar a ciegas, pero nadie sabe que está ahí, así que la barra de acciones en bloque no se alcanza. Y si se marca una, esa barra (`batch-toolbar.tsx:144`, una sola fila) deja Assignee, AutoGate, Delete y Clear fuera de la pantalla (x 350–692). | `21-seleccion-invisible.png` |
| 11 | Filtro de Tasks (y de toda lista que use `data-table-filter`) | *Encontrado en la validación;* corrige la nota "Filtro de Tasks: bien" de la primera pasada. La lista de campos se abre bien, pero al tocar "Status", "Assignee", etc. el panel de valores se coloca a la derecha (`filter-selector.tsx:119`: `absolute top-0 left-full … min-w-[11rem]`). Empieza en x = 334, así que solo se ve una franja de checkboxes, sin etiquetas. No se puede filtrar sabiendo qué se marca. | `22-filtro-valores-fuera.png` |

### 🟠 Se rompe pero se puede usar

| Dónde | Qué pasa | Evidencia |
| --- | --- | --- |
| Projects, Agents, Logs | La barra de filtros se dobla, pero tiene altura fija (`flex h-[48px] flex-wrap`). La segunda línea queda tapada por el encabezado de la tabla: el selector de vista en Projects, "All / Archived" en Agents, "Any output" y Refresh encima de la primera fila en Logs. | `02-barra-doblada-escondida.png`, `09-logs-filtros-encima.png` |
| Tasks | El responsable ocupa hasta 14 rem con el nombre completo (`issue-line.tsx:148`) y el título queda en 8–12 letras ("Crash rep…"). | `03-tasks-titulos-cortos.png` |
| Runs (titulado "Runtimes") | Tabla `table-fixed` con columnas de 120 y 200 px (`run-overview.tsx:248-253`). A la tarea le quedan ~50 px: "BER-501Fronten…" sale pegado y el identificador se parte en dos líneas. **A 320 px es ilegible** (validación): "ASSIGNEE" se pinta encima de "ISSUE", y el identificador encima del título. | `05-runs-columnas-pisadas.png`, `23-runs-320.png` |
| Loops | La fila de KPIs se corta. En "runs need attention" los nombres quedan en 1–3 letras ("W…", "Re…", "Dai…"). El título de la tarjeta y "Last run…" también se truncan. | `04-loops.png` |
| Cycles | En "Done / In progress / Not started" las columnas se juntan ("In progressNot started"). La línea de tiempo (`min-w-[480px]`) y la tabla de ciclos (`min-w-[680px]`) piden scroll lateral. | `18-cycles.png` |
| Settings, todas las páginas | `SettingsRow` (`settings/shared.tsx:184`) pone etiqueta y control en una sola fila a cualquier ancho. `SettingsShell` suma `px-8` (`shared.tsx:53`) y el grupo otros 16 px. Queda una etiqueta de ~55 px: "Full / name" en dos líneas y descripciones de una palabra por línea. | `07-settings-filas-apretadas.png` |
| Settings → Members | El nombre, el correo y "joined 30 Sep 2026" quedan con una palabra por línea: el selector de rol y Remove se comen el ancho. | `06-settings-members.png` |
| Encabezado de Settings | Se repite el nombre: breadcrumb "Settings › Notificat…" y al lado el selector "Notifications ▾". El selector se corta sin elipsis ("Connected accou", "Security & acces"). En Organization y Repositories dice "Settings", porque no están en el menú. | `07-…`, `08-…` |
| Settings → Logs | La tabla mide 1115 px y solo se ven WHEN y PURPOSE. | `09-logs-filtros-encima.png` |
| Drawer de tarea | "No / project" se parte en dos líneas y el título queda en "App i…" (a 360 px, solo "BER-511…"). "Console" flota encima de "Activity". La fila de sub-tareas (campo, Add, "Task") se dobla de forma rara. | `11-drawer-tarea-sin-cerrar.png` |
| Drawer de ciclo | El breadcrumb queda en "Cy…" porque Remove y Activate llenan el header. Las tareas muestran 6–8 letras del título. 13 de 17 controles miden menos de 24 px. | `20-drawer-ciclo.png` |
| Drawer de agente | El aviso "This agent has no runtime…" mide 408 px y se corta. Las pestañas van en una fila con scroll lateral sin pista de que hay más. Los botones de tier solo muestran una letra (M, X, H, L). | `12-drawer-agente.png` |
| Views | El nombre de la vista queda en 6 letras ("Blocke…") frente a la columna del dueño ("Eduardo C…"). | `10-views.png` |
| Chat (página y flotante) | Respuestas del agente a **12 px**, burbujas del usuario a **16 px** (medido). Sigue oscuro en light (decisión pendiente §6.5.1). En `/chat`, el launcher deshabilitado sigue ocupando la esquina. | `19-chat.png`, `13-…` |
| Tablero | *Validación.* Arrastrar una tarjeta de columna no funciona con el dedo: react-dnd va con `HTML5Backend` (`grouped-issues-view.tsx:20`, `projects-board.tsx:11`), que no admite táctil, y en la prueba no hubo ningún `dragstart`. Queda el selector de estado. | código + prueba |
| Perfil de un miembro | *Validación.* Los botones Insights y Perfil del header (`headers/profile/header.tsx:168,181`) se ven en el teléfono, pero sus paneles son `hidden lg:flex` (`member-profile.tsx:202,209`): el botón cambia de estado y no aparece nada. El panel de propiedades/insights del proyecto es `hidden xl:flex` (`project-side-panel.tsx:36`): por debajo de 1280 px no existe. | código |
| Teclado abierto | *Validación* (viewport reducido a 390×508). En New loop, "Draft loop" queda debajo del teclado y el launcher tapa parte del campo. En el chat flotante, Send sigue tapado por el launcher, que sube con el teclado. Nueva tarea, chat de página y Settings → General quedan bien. | `24-teclado-chat-flotante.png`, `25-teclado-nuevo-loop.png` |
| Enlaces profundos sin sesión | *Validación.* Al abrir `/berry/issue/BER-511` sin sesión se va a `/sign-in` sin recordar el destino (`session-gate.tsx:87`). Al entrar, `callbackURL` es siempre `/` (`lib/auth.ts:90,154,169,180`), así que se termina en Tasks. Es lo habitual en el teléfono: enlaces desde el correo o Slack. No es solo de móvil. | código |
| Error disfrazado de vacío | *Validación.* Si la API de tareas falla (500 simulado), Tasks muestra "No tasks yet… Create the first task", sin aviso de error ni reintento. No es solo de móvil. | `26-error-como-vacio.png` |
| Proyecto inexistente | *Validación.* `/berry/project/<id que no existe>/overview` se queda en esqueleto (medido a los 6 s), sin "no encontrado". La tarea inexistente sí lo resuelve bien ("Task unavailable" + "back to tasks"). | `27-proyecto-inexistente.png` |

### 🟡 Pulido

- **Objetivos táctiles menores de 24 px** (mínimo de WCAG 2.2 AA; Apple y Google recomiendan 44 px):

  | Pantalla | Controles pequeños |
  | --- | --- |
  | Skill catalog | 502 de 1018 |
  | Settings → Skill labels | 97 de 294 |
  | Agent catalog | 89 de 192 |
  | Tasks | 73 de 222 |
  | Skills | 66 de 146 |
  | Projects | 18 de 45 |
  | Runs | 16 de 18 |
  | Drawer de ciclo | 13 de 17 |

  Casi todo son checkboxes de fila de 14–16 px, iconos de borrar (Task labels) y manijas de arrastre (Model tiers).
- **Reviews:** filas a 12 px y palabras partidas por `break-all` ("ta / sks").
- **Inbox:** el identificador sale dos veces ("BER-516 BER-516").
- **Plans:** sin título; empieza con el segmentado Open/All y el buscador.
- **Agent catalog:** sin título ni vuelta atrás.
- **Placeholders cortados:** "Search roles and d…", "Search AI provide".
- **Model tiers:** el nombre del tier se corta ("XHig").
- **Pistas de teclado:** "⌘↵ to draft" (New loop), "⌘↵ to plan" (`create-plan-dialog.tsx:169`) y "⌘↵ to create" (`create-milestone-dialog.tsx:190`) no sirven en un teclado táctil.
- **Horizontal (844×390):** en Tasks y Projects el contenido se queda con 221 de 390 px (57 %), y en Inbox con 197. Se lo comen el encabezado (113 px) y la franja inferior. Caben unas 4 filas. Los diálogos sí caben (nueva tarea: 39–389), y el chat flotante a ese ancho ya es ventana y deja Send libre (`28-horizontal-tasks.png`).
- **Vista de tabla:** el título se edita con doble clic (`issue-table.tsx:197`), que en táctil no existe. Queda el drawer.
- **Sign-in:** franja clara de 8 px arriba (el marco de la app) sobre una página oscura, y el logo casi no se ve.
- **Menú abierto:** el launcher Agents (z-45) queda encima del velo del menú (z-40) y sigue brillando sobre la página atenuada.
- **Marco asimétrico:** `--app-inset-*` vale 8 / 6 / 8 / 0 px también en teléfono (`globals.css:1011-1014`). Hay 6 px perdidos a la derecha y 0 a la izquierda.
- **Sin safe areas:** no hay `viewport-fit=cover` ni `env(safe-area-inset-*)`. Con el body fijo a `100dvh` y todo el scroll por dentro, la barra de Safari nunca se esconde.

## Causas raíz (arreglar aquí corrige muchas pantallas)

| Componente | Problema | Pantallas que arregla |
| --- | --- | --- |
| `PageKpiHeader` en `components/common/page/page-parts.tsx:210-212` | Fila fija `h-[52px]`: título y acciones en `ml-auto`, sin `flex-wrap`, sin variante compacta y sin que las acciones se encojan (p. ej. solo icono). | Cycles, Loops, Agents, Skills (botón cortado). También la usan Projects, Tasks, Usage y Plugins, que hoy caben por poco. |
| Barras con `flex h-[48px] flex-wrap` (`projects.tsx:322`, `headers/agents/header-options.tsx:56`, `logs/prompt-logs.tsx:110`) | Se pueden doblar, pero con altura fija la segunda línea se sale de su caja. | Projects, Agents, Logs |
| `components/common/settings/shared.tsx` (`SettingsShell`, `SettingsRow`, filas con `flex shrink-0` en los grupos) | `px-8` fijo, etiqueta y control siempre lado a lado, filas de alta que no se doblan. | Todo Settings, incluidos Members y Connected accounts |
| `components/layout/detail-drawer-shell.tsx` y los headers de drawer | A pantalla completa no hay cierre visible. | Tarea, proyecto, agente, plan, skill, vista, hito |
| `components/common/chat/floating-chat.tsx:350` | Por debajo de `sm` no deja sitio para el launcher ni para el botón de menú. | Chat flotante |
| `components/layout/shell/berry-shell.tsx` y `hooks/use-mobile.ts` | Un único breakpoint (`lg`, 1024): teléfono y tablet comparten menú flotante y franja inferior de 48 px. | Toda la navegación |
| Filas de lista (`issue-line.tsx:148`, `run-overview.tsx` colgroup, views, loops) | El dato secundario tiene ancho fijo o máximo grande y el título se queda con lo que sobra. | Tasks, Runs, Views, Loops, Cycles |
| `opacity-0 group-hover:opacity-100` en 13 archivos (lista en M1.9 y M2.6 del PLAN). Solo `issue-quick-actions.tsx:115` lo condiciona a `(hover: hover)` | En táctil no hay hover, así que el control nunca aparece. | Selección múltiple, menú de Loop, acciones del chat, borrar relaciones, hitos y archivos, pins del menú |
| `components/data-table-filter/components/filter-selector.tsx:119` | El panel de valores va siempre a la derecha (`left-full`), sin variante estrecha. | Filtros de Tasks y de todas las listas que lo usan |

## Lo que está bien

- Ninguna página desplaza la página entera de lado (`scrollWidth` = ancho del viewport en todas las rutas, a 390 y a 360).
- Todos los campos tienen al menos 16 px, así que iOS no hace zoom al enfocarlos.
- Viewport meta correcto (`width=device-width, initial-scale=1`). La letra más pequeña medida es 12 px.
- **Menú:** overlay de 312 px, filas de 44 px, botón de cerrar y velo que se cierra al tocarlo.
- **Nueva tarea:** el diálogo cabe bien y tiene los botones al alcance (`16-nueva-tarea-bien.png`). Con el teclado abierto y en horizontal también.
- **Filtro de Tasks:** la lista de campos se abre dentro de la pantalla. El panel de valores no (🔴 11).
- **Atrás:** el gesto atrás cierra el drawer y vuelve a la lista. Abrir una tarea por URL directa da la página completa, con el botón de menú.
- **Drawers de plan y de skill:** se leen bien a 390 (les falta el ×, como a los demás).
- **Auth:** sign-in, reset password y join caben a 390 sin desbordes. La landing pública también.
- **Errores de arranque y 404 de tarea:** "Berry is unreachable" con "Try again", y "Task unavailable" con "back to tasks". Los dos caben y dejan salida.
- **Carga normal:** esqueletos a 1,2 s y 52 filas a 3,5 s, sin saltos de layout (CLS 0).
- **320 px** (el mínimo de WCAG para reflow): ninguna página se desplaza de lado. Los problemas son los mismos que a 390, más acentuados.
- **Tablero:** columnas de ~270 px con scroll lateral que funciona con el dedo; aceptable para un kanban (`17-tablero.png`). Lo que no funciona es arrastrar tarjetas (🟠).
- **Listas con panel (`split-index.tsx`):** por debajo de `lg` muestran la lista o el detalle, no los dos.
- **Diálogos de ciclos:** ya limitan su ancho a `100vw - 48px`.
- **820 px (tablet):** Tasks, Projects, Cycles, Agents, Runs, Members y el drawer de tarea caben sin desbordes. Lo único que sobra es el menú flotante y la franja inferior, cuando a ese ancho cabría un rail fijo.

## Validación (segunda pasada, mismo día)

Mismo commit (`ae4bcea3`) y misma base de prueba, ya sin el stub de `@swc/core`. Script: [`scripts/mobile-validate.cjs`](scripts/mobile-validate.cjs).

### 1. Los bloqueos de la primera pasada se reproducen

| 🔴 | Medido de nuevo a 390×844 | ¿Sigue? |
| --- | --- | --- |
| 1 | Centro de **Send** (332–364 × 782–814): recibe el toque "Close Agents" | Sí |
| 2 | Drawer de tarea a 390 de ancho sin ningún botón de cerrar. También sin × los de plan, skill, vista (sin cabecera, `29-…`), hito y proyecto (issues/activity) | Sí, y en más drawers |
| 3 | El menú no tiene buscador y sus enlaces no incluyen Chat, Plans, Runs, Views ni Settings | Sí |
| 4 | "Create link" en x = 344–456, fuera del viewport | Sí |
| 5 | "Add" en x = 376–436, fuera | Sí |
| 6 | "Create with agent" empieza en x = −23 | Sí |
| 7 | Tres chips, y además "Manage views" y el "New view" de la fila, fuera (x hasta 1255). Hay otro "New view" alcanzable | Sí, peor |
| 8 | New cycle termina en 406, New agent en 412 y New skill en 393. New loop cabe (387) | Sí, salvo Loops a 390 |

### 2. Correcciones a la primera pasada

- **"my-tasks" no existe:** redirige a Inbox, así que la primera pasada midió Inbox dos veces.
- **Las rutas que parecían sin revisar son redirecciones** a páginas que ya estaban: dashboard → Usage, approvals y proposals → Inbox, goals y milestones → Projects, my-issues → Tasks, members/runtimes/logs → Settings, autopilots → Loops, agent → Agents. No había huecos de cobertura ahí.
- **Filtro de Tasks:** la primera pasada lo dio por bueno, pero solo abrió la lista de campos. Los valores salen fuera de la pantalla (🔴 11).
- **Tablero:** el scroll lateral con el dedo funciona (eventos táctiles: `scrollLeft` 0 → 235). Lo que no funciona es arrastrar una tarjeta: react-dnd usa `HTML5Backend` (`grouped-issues-view.tsx:20`, `projects-board.tsx:11`), que no admite táctil, y la prueba no registró ningún `dragstart`. Mover de columna solo se puede con el selector de estado.

### 3. Huecos de la primera pasada, ahora cubiertos

| Hueco | Resultado |
| --- | --- |
| Teclado (viewport reducido a 390×508 con el campo enfocado) | Nueva tarea, chat de página y Settings: bien. Chat flotante: Send sigue tapado. New loop: "Draft loop" queda debajo del teclado (🟠) |
| Horizontal (844×390) | Sin desbordes. El contenido se queda con el 57 % del alto (🟡). Diálogos y chat flotante bien |
| Submenús del filtro | Se abren con toque, pero fuera de la pantalla (🔴 11) |
| Drawers de plan, skill, vista, hito, perfil y pestañas de proyecto | Todos se abren como drawer (navegación cliente), sin desbordes salvo los chips de Views. Ninguno tiene × |
| Auth sin sesión | Sign-in, reset y join caben. Los enlaces profundos pierden el destino (🟠) |
| Error, 404, red lenta y sin conexión | Arranque caído y 404 de tarea: bien. Error de la API de tareas = "No tasks yet" (🟠). Proyecto inexistente: esqueleto sin fin (🟠). Con 2,5 s de latencia por llamada, "Loading Berry" sigue a los 8 s (PLAN M6.4). Sin red, tocar una tarea saca de la app a la página de error de Chrome (PLAN M6.5) |
| 320 px | Ninguna página se desplaza de lado. Peor que a 390: encabezados, Runs (ilegible, 🟠) y la fila de botones de New loop (termina en 340) |
| Controles con hover en táctil (opacidad efectiva 0) | Tasks 50 (checkbox de selección), drawer de ciclo 12 ("Remove … from this cycle"), Views 5 (menú de cada vista), Loops 4 ("Loop actions"), Chat 2 ("Copy"), drawer de proyecto 2 (borrar hito). Además, 2 pins del menú en todas las páginas |
| Long-press (menú contextual de tareas) | En la emulación no se abrió. Radix lo admite en táctil, pero en iOS el long-press sobre un enlace (las filas lo son) abre la vista previa del sistema. Las filas no tienen "⋯" visible, así que esas acciones dependen del long-press. **Hay que probarlo en un iPhone** |

## Teléfono real: Android (tercera pasada)

**Dispositivo y conexión:**
- Samsung Galaxy A14 (SM-A146M), Android 15, Chrome 157.
- 411×821 px CSS (DPR 2,625), navegación por gestos y tamaño de letra del sistema al 80 %.
- Conectado por depuración inalámbrica. `adb reverse tcp:3100` lleva `localhost:3100` del teléfono a la web de prueba.

**Cómo se probó:** toques, long-press y arrastres reales con `adb shell input`, y el teclado real (Samsung Keyboard). La página se lee por CDP (`adb forward` → Playwright `connectOverCDP`) y solo se toca la pestaña de la app. Scripts: [`scripts/phone-lib.cjs`](scripts/phone-lib.cjs) y [`scripts/phone-tests.cjs`](scripts/phone-tests.cjs).

**Sobre la rama `fix/mobile`**, ya con M1.1, M1.2, M1.3, M1.5 y M1.6:

| Prueba | Resultado en el dispositivo | |
| --- | --- | --- |
| **Cómo responde el teclado** | Chrome Android **no reduce el layout viewport** (sigue en 821 px). Achica el visual viewport (a 500 o 436 px) y lo desplaza para que el campo enfocado quede a la vista. Lo `fixed` abajo (launcher, botón de menú) sigue anclado al layout viewport. La emulación de la segunda pasada (viewport reducido) era el caso `resizes-content`, y no es lo que hace este teléfono. | — |
| Chat flotante + teclado (M1.1) | Send y el composer quedan encima del teclado y se pueden tocar. El header de la ventana (×, minimizar) queda fuera de la vista mientras el teclado está abierto. | ✅ `30-tel-chat-teclado.png` |
| Drawer de tarea (M1.2) | El × (44×52) aparece y al tocarlo vuelve a `/berry/tasks`. El campo de comentario queda a la vista con el teclado. | ✅ |
| Search del menú (M1.3) | Abre la paleta y el teclado. **Pero la paleta está centrada y el teclado tapa casi todos los resultados** (se ven 3). Además, "Ctrl+Enter opens in a new tab" se pinta **encima del placeholder**, y los chips de atajos ("G I", "G P") no sirven en táctil. | ⚠️ `34-tel-paleta-teclado.png` |
| New loop + teclado | "Draft loop" (y = 511–555) queda **debajo del teclado** (visible hasta y = 500). La pista "⌘↵ to draft" sí se ve, aunque no sirve. Hay que cerrar el teclado o desplazar la página para crear. | ❌ `31-tel-nuevo-loop-teclado.png` |
| Nueva tarea + teclado | Al abrir, el foco va a × y no sale el teclado (bien). Al tocar el título, "Create task" (y = 603–647) queda **debajo del teclado** (visible hasta 436). El teclado ofrece "siguiente" en lugar de "hecho", y Chrome muestra su barra de autocompletar (llave, tarjeta, ubicación) en el título. | ❌ `32-tel-nueva-tarea-teclado.png` |
| Long-press sobre una tarea | **Funciona en Android:** abre el menú contextual de Radix, sin el menú del sistema. Pero queda pegado al borde derecho y enseña atajos de teclado (⌘ L, ⌘ ⌫). | ✅ con detalles `33-tel-long-press.png` |
| Tablero: deslizar | El scroll lateral con el dedo funciona (`scrollLeft` 0 → 416). | ✅ |
| Tablero: arrastrar una tarjeta | Long-press y movimiento lento de 3 s: **ningún `dragstart`**, y la tarjeta no se mueve. Confirma que `HTML5Backend` no sirve con el dedo. | ❌ |
| Panel de valores del filtro (🔴 11) | Igual que en la emulación: empieza en x = 338 de 411 y solo se ven el checkbox y el principio de cada etiqueta. | ❌ `35-tel-filtro-valores.png` |
| Safe areas | Con navegación por gestos, `env(safe-area-inset-bottom)` = 0,14 px. Chrome pinta la página por encima de la barra de gestos, así que hoy no hay nada tapado abajo. | ✅ |
| Letra del sistema al 80 % | No afecta a la página (raíz a 16 px). | — |

## No cubierto (necesita un iPhone u otra prueba)

- **Teclado de iOS:** iOS Safari tampoco reduce el layout viewport, pero desplaza la página entera. Con `body` a `100dvh` fijo, hay que verlo en un iPhone.
- **Long-press en iOS:** puede abrir la vista previa del enlace del sistema en vez del menú contextual (en Android funciona).
- **Arrastre en Safari iOS.**
- **Safe areas con notch** (iPhone).
- **Lectores de pantalla:** VoiceOver y TalkBack. No activé TalkBack en tu teléfono porque es un ajuste del sistema; si quieres, lo activas tú y lo pruebo.
- **Texto ampliado** del sistema por encima del 100 %.
- **Rendimiento:** con un build de producción (`next dev` no sirve para medirlo).

## Plan

Las fases, las tareas con su alcance y su criterio de hecho, y las decisiones pendientes están en [PLAN.md](PLAN.md).

## Aviso de entorno (no es de la app)

- **Primera pasada:** el dev server no arrancaba. *Smart App Control* de Windows (política `{0283ac0f-…cad6}`, eventos 3077 de CodeIntegrity) bloqueaba el binario nativo de `@swc/core`, que `next-intl/plugin` carga siempre al leer `next.config.ts`. El servidor de prueba arrancó con un `--require` que le entregaba un módulo vacío.
- **Validación:** Smart App Control ya está apagado. `@swc/core` carga y `next dev` arranca sin el stub; la segunda pasada corrió así.

## Cómo se midió

- **Script de Playwright:** recorre 39 páginas y 6 drawers de detalle con un contexto móvil y mide, en light:
  - cajas que salen del viewport, y quién las recorta;
  - texto cortado sin elipsis (casi todo resultó `sr-only`, falso positivo);
  - objetivos táctiles menores de 24 px;
  - campos con letra menor de 16 px;
  - elementos `fixed`;
  - tamaños de letra.
- **Flujos probados con toque:** menú, menú de Settings, drawer de tarea (arriba y abajo), nueva tarea, filtro, opciones de vista, tablero, chat flotante (con `elementFromPoint` sobre Send), drawer de proyecto, nuevo proyecto y drawer de agente.
- **Validación:** [`scripts/mobile-validate.cjs`](scripts/mobile-validate.cjs), con 8 secciones:
  - comprobación de los bloqueos;
  - teclado (viewport 390×508 con el campo enfocado);
  - horizontal 844×390;
  - submenús del filtro;
  - drawers abiertos por navegación cliente;
  - auth con el dev-login rechazado;
  - error simulado (API caída, 500, 404, 2,5 s de latencia y sin conexión);
  - toque (opacidad efectiva de los controles, long-press y arrastre con eventos táctiles de CDP).
  
  Además, otra pasada completa de [`scripts/mobile-audit2.cjs`](scripts/mobile-audit2.cjs) a 320×568, y [`scripts/board-probe.cjs`](scripts/board-probe.cjs) para el scroll del tablero.
- **Scripts:** necesitan la web de prueba en `localhost:3100` y la API en `:4100` con la base de datos de prueba. Uso:
  - `node scripts/mobile-audit2.cjs <salida> [ancho] [alto] [filtro]`
  - `node scripts/mobile-validate.cjs <salida> [sección]`
  - `node scripts/mobile-flows.cjs <salida> [flujo]`
  - `node scripts/board-probe.cjs` (escribe en `validate/`)
- **Revisión del código** para cada causa raíz.
