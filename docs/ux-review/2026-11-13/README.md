# Pendientes de UI en light y dark (13 nov 2026)

Análisis sin cambios de código. Sale de revisar cada pantalla en los dos temas y de buscar en el código los colores que no siguen al tema.

- **Rama:** `perf/boot-realtime` @ `679fda92`, con la base de prueba (`prototype@berry.test`, workspace `berry`).
- **Capturas:** 1280×800. Cada imagen tiene light a la izquierda y dark a la derecha. El tema se cambió con la clase `.dark` sobre `<html>`, igual que el selector de Preferences.
- **Pantallas:** 47 rutas (varias redirigen), 6 drawers de detalle y 4 estados de interacción (hover de fila, chat flotante, paleta de comandos y nueva tarea).
- **Contexto:** el plan de rediseño (`docs/redesign/ledger-plan.md` §7) tiene las fases 4 (colecciones), 5 (superficies de detalle), 6 (gráficas) y 7 (barrido de hallazgos) sin empezar (`ledger-progress.md`). Casi todo lo de abajo cae en esas fases.

Las imágenes de esta carpeta son la evidencia de cada punto.

---

## 1. Lo que ya quedó pulido (no repetir)

Hecho en las sesiones del 12 y 13 de noviembre, según los commits `style/fix(frontend)` de la rama:

- **Shell:**
  - Rail en light.
  - Settings rail con grupos plegables; Workspace y Connections empiezan plegados.
  - Sin borde en el canvas en light (main y settings).
  - Pins fuera del rail de Settings.
  - Selector de tema en Preferences.
- **Primitivos:**
  - Switch en berry con el thumb centrado.
  - Checkbox relleno en berry con la palomita blanca, también dentro de menús.
  - Control segmentado con la selección deslizante, en light y dark.
  - Botón AI deshabilitado sin glow.
  - Avatares de 20px con iniciales de 11px.
- **Tasks y Projects:**
  - Columnas, tarjetas, filtros y buscador del kanban en light.
  - Cambio de vista lista/tablero/timeline.
  - Valores de propiedades en 500.
- **Detalle de tarea:**
  - Composer de comentarios: botón de envío blanco sobre berry, estados debajo de la caja y foco en berry.
  - Quick actions como sección completa, con Run en hover.
  - Flechas prev/next sin apilar historial y con alerta de descarte.
  - Drawer persistente con skeletons.
  - Botón Console a la altura estándar.
- **Settings:**
  - Grupos grises.
  - Inputs con radio de 8px y foco en berry.
  - Breadcrumb alineado al baseline.
  - Shortcuts (tinta, fondo y altura del buscador).
  - Altura de los campos de Security.
  - Checkboxes de API tokens.
  - Filtro de AI providers.
- **Flotantes:**
  - Pila inferior derecha (Agents se empuja hacia arriba).
  - Toasts con la acción abajo a la izquierda.
  - Agents se esconde tras un minuto inactivo.
- **Loops:** Filter a la izquierda y All | Archived a la derecha.

---

## 2. Problemas transversales (atacarlos una vez arregla muchas pantallas)

Ordenados por impacto.

### 2.1 Hover oscuro en filas, en light (alto)

- **Qué pasa:** 27 usos de `hover:bg-sidebar/50`, `bg-sidebar/40` y `bg-sidebar/60` (fila seleccionada). En light, `--sidebar` vale `var(--brand-base)` = `#19191c` (`app/globals.css:283`). Al pasar el mouse, la fila se pone gris oscuro y el texto pierde contraste. Medido en el navegador: `oklab(0.18 … / 0.5)`.
- **Evidencia:** `01-agents-hover-light.png`.
- **Dónde:**
  - `agents/agent-line.tsx:117-118`, `agent-catalog.tsx:400`, `agent-work-tab.tsx:47`, `agents.tsx:433`, `new-agent-builder.tsx:245`.
  - `skills/skill-line.tsx:81-82`, `skill-catalog.tsx:432`.
  - `issues/details/issue-relations.tsx:149,192`, `content-blocks.tsx:275`.
  - `milestones/milestone-line.tsx:36`, `plans/plans-list.tsx:138`, `projects/details/project-plan-section.tsx:93`.
  - `reviews/diff-view.tsx:20,55`, `runs/run-overview.tsx:306`, `views/views.tsx:139`.
  - `layout/notifications/notifications-drawer.tsx:103-104`.
- **Idea:** un token de hover de fila (`--row-hover`, o `--settings-row-hover`, que ya existe) en lugar de `sidebar`.

### 2.2 `<main>` pinta oscuro en light (alto)

- **Qué pasa:** `berry-shell.tsx:194` pone `bg-[var(--shell-canvas)]`. `--shell-canvas` solo es blanco dentro de `[data-shell-chrome]` (el rail); en `<main>` sigue siendo `#19191c`. Medido: `rgb(25, 25, 28)` en los dos temas.
- **Consecuencia:** no se nota mientras la página pinta su propio fondo. Pero en redirects, cargas o páginas vacías aparece un rectángulo negro dentro del marco claro.
- **Evidencia:** `02-main-oscuro-en-redirect.png`, capturada en `/settings/project-statuses`, que redirige a Preferences.
- **Idea:** un fondo de contenido que siga al tema (`--background` o `--container`) para `<main>`. `--shell-canvas` se queda para el chat.

### 2.3 Botones secundarios sin forma dentro de grupos de Settings, en light (alto)

- **Qué pasa:** el fondo del botón secundario (`--secondary` = `#f5f5f5`, `globals.css:216`) es prácticamente igual al del grupo (`--settings-group` = `#f4f4f5`, `:299`). En light se leen como texto suelto; en dark sí tienen píldora.
- **Botones afectados:**
  - Members: Remove.
  - General: Change prefix, Leave workspace, Delete workspace.
  - Security: Sign out.
  - Connected accounts: Remove, Add.
  - MCP: Add header.
  - Shortcuts: las teclas (`Ctrl`, `B`…) pierden su forma de tecla.
- **Evidencia:** `03-settings-general.png`, `04-settings-shortcuts-teclas.png`.
- **Idea:** dentro de `--settings-group`, que el secundario use `--card`/blanco con borde, o un gris un paso más oscuro.
- **De paso:** "Delete workspace" no se distingue como destructivo en ningún tema.

### 2.4 El botón flotante Agents tapa contenido y queda por encima de los modales (alto)

- **Tapa contenido:** ninguna lista deja espacio al final. Tapa la última fila en Agents, Runs, Cycles (Completed), Agent catalog (Add), Logs y Tasks.
- **Lo más grave está en Plans:** la barra de acciones del plan ("Reject" y la acción principal) queda debajo del botón (`05-plans-accion-tapada.png`). Esa barra no está registrada en la pila flotante (`store/floating-stack-store.ts`), que hoy solo usan Restart/Console.
- **Encima de los modales:** con el diálogo de nueva tarea o la paleta de comandos abiertos, el botón sigue brillante y clicable sobre el overlay (`06-new-task-launcher-encima.png`). El dock es `z-50`, igual que los overlays de Radix.
- **Idea:** dos cosas.
  - Un `padding-bottom: var(--shell-launcher-clear)` en los scrollers de página.
  - Bajar el launcher (o esconderlo) mientras hay un diálogo abierto.

### 2.5 Superficies que siguen oscuras en light (decisión pendiente)

El plan (§6.5.1) dejó abierta la pregunta: el chat y el tablero ¿son contenido que se vuelve claro, o una firma oscura? El tablero ya se pasó a light. Esto sigue oscuro en light:

| Superficie | Por qué | Evidencia |
| --- | --- | --- |
| Página Chat (`/chat`) | 10 archivos en `components/common/chat/` pintan con `--shell-*` | `07-chat.png` |
| Ventana de chat flotante | igual | `08-chat-flotante.png` |
| Paleta `@` / `/` en comentarios de tarea y updates de proyecto | `composer-palette.tsx:271` usa `--shell-surface` y `--shell-text` | código; la captura no se logró |
| Toasts | `ui/sonner.tsx:26` fija `bg-black/80 text-white` | sesión anterior |
| Editor de código, visor de artefactos, transcript | `--brand-void` / `--brand-chalk` fijos (`artifact-viewer.tsx:502`, `transcript-dialog.tsx:690`) | código |
| Pantallas de auth e invitación | `BrandThemeCanvas` (lienzo void fijo) | código |

Además, en la página Chat en light, el botón Agents queda gris claro sobre fondo oscuro y parece deshabilitado. En dark casi no se ve.

### 2.6 Botones "catálogo" negros fijos (medio)

- **Qué pasa:** `Agent catalog` (`layout/headers/agents/header.tsx:22`) y `Skills catalog` (`app/[orgId]/skills/page.tsx:213`) llevan `!bg-black !text-[#cdcdcd] border-[#ccc]/40`.
- **Consecuencia:** en light son una píldora negra pesada que compite con el botón berry de al lado. En dark se funden con el fondo.
- **Evidencia:** `09-agents.png`.
- **Idea:** pasarlos a la variante `dark` de `button` (que ya cambia según el tema) o a la secundaria.

### 2.7 Páginas de Settings fuera del menú (medio)

- **Qué pasa:** `organization` y `repositories` existen como páginas, pero no están en `components/layout/sidebar/nav-settings.tsx:80-106`. (`plugins`, `join-links`, `profile`, `project-statuses` y `usage` redirigen a otras páginas, así que no cuentan.)
- **Consecuencias:**
  - El breadcrumb se queda en "Settings" sin el nombre de la página.
  - Ningún ítem del rail se marca.
  - Al estar Workspace plegado por defecto, no hay pista de dónde estás.
- **Evidencia:** `10-settings-organization.png`.
- **Relacionado:** al entrar directo a una página de un grupo plegado (por ejemplo `/settings/quick-actions`), el grupo no se abre solo y el ítem activo queda abajo, fuera de la vista.

### 2.8 Textos cortados con "…" (medio, ambos temas)

- **Settings rail:** "Keyboard short…", "Connected acc…", "Security & acce…" (activo, en negrita). El rail de 218px no alcanza.
- **Loops:** tiles KPI "Runs this we…" y "Need attenti…". Títulos de tarjeta en mono: "Weekly dependency…", "Review new bug re…". Pie "Last …".
- **Agents:** encabezado de columna "LAST ACTIV…".
- **Runs:** columna Assignee "Front…", "DevO…", "QA E…".
- **Usage:** treemap "Software Engin…", "DevO…", "$6…", "9 run…"; dona "Claude So…". El "$17" grande se corta abajo.
- **Projects:** Lead "Liam N…", "Project l…".
- **Logs:** la tabla se sale por la derecha (se ve "STA" de STATUS) y Prompt queda en "Board v…".

### 2.9 Alturas de input frente a botón (bajo, ambos temas)

Mismo caso que ya se corrigió en Shortcuts: el input mide unos 32px junto a un botón de 44px.

- Task labels: "Filter by name…" y "New label" junto a Create.
- Connected accounts: email junto a Add.
- Logs: los selects de filtro junto a Refresh.

### 2.10 Formas mezcladas en un mismo formulario (bajo)

- **Security:** "Current password" es píldora; el resto de Settings usa 8px.
- **New workspace:** Name, Address y Prefix son píldora; Description es rectángulo.
- **Agent drawer:**
  - El nombre es píldora y la descripción, rectángulo.
  - Tier usa tarjetas rectangulares; Runtime y Concurrency usan píldoras.

### 2.11 Campos de Settings en dark sin borde (bajo, dark)

- **Qué pasa:** en dark, el fondo del input queda casi igual al del grupo (`--settings-group` `#1f1f23`) y sin borde. Full name, los selects de Preferences, Members (rol) y MCP (Name, URL) apenas se distinguen como campos. En light tienen borde y fondo blanco.

### 2.12 Anillo de foco visible al abrir un drawer (bajo, ambos temas)

- **Qué pasa:** al abrir un drawer, el foco cae en el primer control y se dibuja el anillo berry sin haber usado el teclado.
  - Tarea y proyecto: el botón "…".
  - Ciclo: el link "Cycles" del breadcrumb, con un anillo cuadrado que no sigue el radio.
  - Agente: la pestaña "General".
- **Idea:** enfocar el contenedor del diálogo, o usar `:focus-visible` real.

### 2.13 Acento fuera de paleta (bajo)

- **Dorado:** "New milestone" y "Generate task" en el drawer de proyecto usan `text-ripe` (dorado `oklch(70% 0.13 85)`). En light, dorado sobre blanco queda cerca de 2:1. Los rombos de milestone usan `amber-400`/`amber-500` de la paleta de Tailwind (`project-milestones-section.tsx:261,289,338`).
- **Azules e índigo:** los iconos de plantilla en Loops → New loop. El resto de la app gasta solo berry.

---

## 3. Por sección

Leyenda: ✅ pulido · 🟡 detalles · 🔴 pendiente fuerte. "Ambos" significa que pasa en light y en dark.

### Personal

**Inbox 🟡** (`11-inbox.png`)
- Ambos:
  - El identificador sale dos veces: "BER-516 BER-516 Play Store listing…". El título de la notificación ya trae la ref y la fila la vuelve a anteponer.
  - Las filas con el punto de no leído desplazan la hora unos 18px, así que la columna de tiempo no queda alineada.
- Light: bien.
- Dark: bien.

**Reviews 🟡** (`12-reviews.png`)
- Ambos:
  - Los títulos cortan a mitad de palabra: "share shee / t", "50 / 0 tasks", "la / rge workspaces". Hay un `break-all` donde debería ir `break-words`.
  - El texto de las filas es pequeño (unos 13px) frente al cuerpo de 16px que se fijó.
- Light: bien.
- Dark: bien.

### Work

**Projects ✅** (lista, tablero y timeline ya pulidos)
- Ambos: solo quedan los Lead truncados.

**Tasks ✅**
- Ambos: los nombres de personas asignadas salen en berry (Eduardo Cortez, Maya Chen). Confirmar si es intencional, porque el plan reserva berry para "lo que espera a una persona".

**Cycles 🟡** (`13-cycles.png`)
- Ambos:
  - El círculo de selección de la fila "Upcoming" casi no se ve.
  - Agents tapa la columna Done de "Completed".
- Light: los segmentos de días futuros en la barra de progreso son casi blancos sobre blanco.
- Dark: esos mismos segmentos casi no se ven.

**Loops 🟡** (`14-loops.png`)
- Ambos: los tiles KPI y los títulos de tarjeta están truncados (ver 2.8).
- New loop: iconos de plantilla en azul/índigo (2.13).
- Light: el panel "11 runs need attention" y las tarjetas se ven bien.

**Plans 🔴** (`05-plans-accion-tapada.png`)
- Ambos:
  - Sin encabezado de página (empieza con Open | All y el buscador).
  - El título se repite en la fila ("Onboarding revamp / Onboarding revamp").
  - La acción principal queda debajo de Agents.
- Nota: en otra rama hay `b7d3a510 refactor(server-ts): remove plans`. Conviene confirmar si Plans sigue antes de pulirla.

**Chat 🔴** (`07-chat.png`)
- Light: todo oscuro (2.5).
- Ambos:
  - El texto de las respuestas del agente es bastante más chico que las burbujas del usuario.
  - Los chips "Suggested next" tienen poco contraste.

### Manage

**Agents 🟡** (`09-agents.png`, `01-agents-hover-light.png`)
- Light:
  - Hover oscuro (2.1).
  - Botón catálogo negro (2.6).
- Ambos: "LAST ACTIV…" truncado.

**Agent drawer 🟡** (`15-agent-drawer.png`)
- Ambos:
  - Las tarjetas de Tier tienen fondo de color (Max y High rosados, XHigh azulado) aunque no estén seleccionadas, así que parecen elegidas. La seleccionada (Mid) es gris.
  - Mezcla de formas (2.10) y foco en la pestaña (2.12).

**Agent catalog 🟡**
- Ambos:
  - Sin título ni regreso a Agents. La página empieza directo con el buscador.
  - Agents tapa el último "Add".
- Light: fila seleccionada con `bg-sidebar/60` oscuro (2.1).

**Skills / Skills catalog 🟡**
- Igual que Agents: hover, botón negro y catálogo sin título.

**Connect (`/integrations`) 🟡**
- Ambos: el vacío "No plugins yet" es solo una banda gris, sin explicación ni acción.

**Usage 🔴** (`16-usage.png`, fase 6 del plan)
- Light: barras y treemap en negro puro; los bloques pesan demasiado.
- Dark: barras y treemap en blanco puro; los bloques pesan demasiado.
- Ambos:
  - La leyenda "Dollars ● Runs" usa el mismo color para las dos series.
  - Hay muchos textos truncados (2.8).

**Runs (`/runs`) 🟡** (`17-runs.png`)
- Ambos:
  - La página se titula "Runtimes" aunque es la lista de runs.
  - Ningún ítem del rail queda activo.
  - Assignee truncado.
  - Agents tapa la última fila.

### Detalles (drawers)

**Tarea ✅🟡** (`18-issue-drawer.png`)
- Ambos:
  - En Properties hay dos "Set date" sin etiqueta (inicio y vencimiento no se distinguen).
  - "None" (sin proyecto) lleva un icono berry.
  - Foco visible en "…" (2.12).

**Proyecto 🟡** (`19-project-drawer.png`)
- Light: dorado de bajo contraste (2.13).
- Ambos:
  - "Dec 12 0%" pegado, sin separación ni etiqueta.
  - Las fechas usan formatos mezclados: "18 Nov 2026" en Properties y "31 Oct 2026, 08:30" en Details. La fase 7 del plan pide un solo formato.
  - Las fechas de Properties no tienen etiqueta.

**Ciclo 🟡** (`20-cycle-drawer.png`)
- Ambos:
  - Remove y Activate tienen el mismo peso. Remove no se ve destructivo y Activate no se ve como la acción principal.
  - El encabezado no sigue el patrón de los otros drawers (X en lugar de "…").
  - Los radios a la derecha de Assignees casi no se ven.
  - Anillo cuadrado de foco en "Cycles".

**Review (`/review/{id}`) 🟡** (`21-review-detail.png`)
- Ambos:
  - Las etiquetas "Delivered", "Branch", "Changes" y "Checks" son píldoras con borde. Parecen botones aunque solo son rótulos.
  - Hay un control segmentado con una sola pestaña ("Overview").
  - La lista de la izquierda tiene los mismos cortes de palabra que Reviews.
- Light: Accept y Decline se ven bien.
- Dark: Accept y Decline se ven bien.

**Loop (`/loop/{id}`) 🟡** (`22-loop-detail.png`)
- Ambos:
  - Run history trunca el título ("Weekl…") y los puntos de estado son diminutos.
  - Hay chips "Soon" para funciones sin construir ("Ask the agent about a run", "Earlier versions and restore").
  - La fecha de versión es "17/10/2026", un tercer formato de fecha (ver Proyecto).
  - Agents tapa el valor de Owner.
- Light: los campos se distinguen bien.
- Dark: los campos se distinguen bien.

**Skill drawer y detalle de plan:** no se capturaron, porque las filas de esas listas no son enlaces y el script abre los drawers siguiendo enlaces. Quedan por revisar a mano.

### Settings

| Página | Estado | Notas |
| --- | --- | --- |
| Preferences | ✅ | En dark, los campos no tienen borde (2.11) |
| Notifications | ✅ | — |
| Keyboard shortcuts | 🟡 | En light las teclas pierden su forma (2.3) |
| Security & access | 🟡 | Sign out sin forma en light; password en píldora (2.10) |
| API tokens | ✅ | La captura se quedó en "Loading Berry" (boot); revisado en sesión anterior |
| Connected accounts | 🟡 | Remove y Add sin forma en light; input más bajo que Add |
| General | 🟡 | Change prefix, Leave y Delete sin forma en light; Delete no se ve destructivo |
| Members | 🟡 | Remove sin forma en light; el select de rol de la fila "(you)" queda desalineado (no tiene Remove al lado) (`23-settings-members.png`) |
| AI providers | ✅ | — |
| Model tiers | 🟡 | La primera apertura tardó más de 20s ("Loading…"); es la sonda en frío del CLI (`0ad18fd8` ya la reusa en lecturas siguientes) |
| Task labels | 🟡 | Inputs más bajos que Create (2.9) |
| Skill labels | ✅ | — |
| Task fields | — | La captura no cargó a tiempo; queda por revisar |
| Quick actions | ✅ | El ítem activo queda abajo, fuera de la vista del rail |
| Logs | 🟡 | La tabla se sale por la derecha; filtros más bajos que Refresh (`24-settings-logs.png`) |
| Source control | ✅ | — |
| MCP servers | 🟡 | Add header sin forma en light; campos sin borde en dark |
| Organization, Repositories | 🔴 | Fuera del menú: sin breadcrumb ni ítem activo (2.7) |

### Superposiciones

- **Paleta de comandos ✅:** bien en los dos temas. En dark, el borde de la paleta se pierde un poco contra el fondo atenuado. Agents queda encima del overlay (2.4).
- **Nueva tarea ✅:** bien. Agents queda encima del overlay (2.4).
- **Chat flotante 🔴:** oscuro en light (2.5). En dark, la ventana no tiene borde ni sombra que la separe de la página: se funde con el contenido de atrás (`08-chat-flotante.png`).
- **Toasts 🟡:** siempre negros (2.5).

### Fuera del shell

- **New workspace 🟡:** formas mezcladas (2.10). Por lo demás bien en los dos temas.
- **Sign-in, invitaciones, reset password:** siempre oscuros por diseño (`BrandThemeCanvas`). Falta decidir si siguen la preferencia de tema o la cookie.

---

## 4. Pendientes que quedaron de sesiones anteriores

- Abrir una tarea por URL y usar las flechas abre un drawer encima de la página completa; al cerrarlo queda la página. No se ha corregido.
- La alerta de "cambios sin guardar" está probada en la respuesta a comentarios, pero no en el visor de artefactos ni en preview-env.
- El chat flotante abierto junto a Restart/Console en la pila no se verificó.
- Runtime (funcional, no visual): el aviso "This agent has no runtime" no cuenta los CLIs de la estación. Además, la colocación por tier elige el primer modelo conectado aunque no pueda ejecutar en este despliegue. Está esperando tu decisión.

## 5. Lo que este análisis no cubre

- Ancho móvil (390px). El plan pide 1280 y 390 en los dos temas.
- Estados de error y vacíos fuera de los que salieron con los datos de prueba.
- Hover y foco en general, salvo filas de Agents y los drawers.
- La paleta `@`/`/` en vivo: la captura falló y el hallazgo sale del código.
- Storybook.

## 6. Orden sugerido

1. **Arreglos de token que tocan muchas pantallas con pocas líneas:** 2.1 (hover de filas), 2.2 (fondo de `<main>`) y 2.3 (secundario dentro de grupos). Son tres cambios en `globals.css` o en clases repetidas.
2. **Agents sobre el contenido y los modales (2.4),** empezando por la barra de Plans.
3. **Settings:** el menú completo (2.7) y las alturas (2.9).
4. **Decidir §6.5.1** (chat, paleta del composer, toasts y editor: ¿claros u oscuros?) y aplicarlo.
5. **Colecciones (fase 4):** truncados (2.8), Reviews, Inbox, Runs y los catálogos.
6. **Detalles (fase 5):** drawers de proyecto, ciclo y agente, el foco al abrir y las fechas.
7. **Gráficas (fase 6):** Usage, y las barras y burn-up de Cycles.
