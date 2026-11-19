# Bitácora: arreglo móvil, Fase 1

> Estado para retomar el trabajo. El plan está en [PLAN.md](PLAN.md) y el análisis en [README.md](README.md).

## Inspección completa en escritorio y móvil (2026-11-18)

Se recorrieron todas las rutas de la auditoría (45 pantallas, más los detalles de tarea, proyecto, ciclo, agente, review y loop), en claro y oscuro:
- **Móvil (390 px):** con `mobile-audit2.cjs`.
- **Escritorio (1440 px):** con una copia de escritorio del mismo script, sin emulación táctil.

**Mediciones:**
- Ninguna pantalla se desplaza de lado en ninguna de las dos anchuras.
- Casi todos los avisos automáticos son falsos positivos:
  - **Texto cortado:** textos solo para lectores de pantalla (`sr-only`).
  - **Fuera de pantalla:** contenido dentro de zonas con scroll lateral a propósito.
  - **Objetivos pequeños:** los switches y el botón Copy del chat ya amplían su área táctil con un pseudo-elemento.

**Arreglado:**
- **Review (móvil):** el texto se partía palabra por palabra junto a Accept/Decline. Ahora tiene base de 16rem y los botones bajan de línea.
- **Loop (móvil):** el nombre quedaba en una letra. La cabecera se parte por debajo de `sm`: nombre y estado arriba, acciones en su fila. El "…" usa el tamaño por defecto en vez de `size-11`.
- **New agent (móvil):** la fila de pestañas centrada se salía por la izquierda ("neral"). Ahora usa `justify-center-safe` con scroll lateral.
- **`SettingsRow`:** la etiqueta tenía base 0 y se encogía a "Transp" junto a un control ancho. Con base de 8rem, el control baja de línea en pantallas angostas.
- **AI providers (móvil):** la búsqueda pasa a todo el ancho; antes cortaba su placeholder.
- **Catálogos de agentes y skills:** no tenían título en escritorio, y el de skills tampoco en móvil. Ahora comparten `PageBackTitle` (flecha de vuelta y título) en todas las anchuras. Se añadió "Back to Skills".
- **Catálogo de skills (móvil):** los chips de departamento reducían el nombre a 1–4 letras. Ahora pasan a la línea de abajo.
- **Settings → Agents (`/settings/ai`) y Connect (`/settings/plugins`):** el selector y la ruta de migas decían "Settings". Ahora nombran la página.
- **Chat:** las sugerencias llegaban después de bajar al último mensaje y quedaban bajo el borde del compositor. Ahora se traen a la vista si el lector sigue al final.
- **Usage → "Who spent it":** el monto de un bloque angosto se truncaba ("$11.…"). Cada bloque es ahora un contenedor y el monto se achica con él (`min(tamaño, 18cqi)`).

## Detalle del agente, Usage y elementos flotantes (2026-11-18)

El usuario devolvió `--field-h` a 32 px a mano (y añadió `px-4` a `KpiStrip`); se subió tal cual en ad6a61ae. Después pidió:

**Detalle del agente:**
- **Un solo scroll:** la cabecera del agente se desplaza, la fila de pestañas queda fija arriba y ninguna pestaña tiene scroll propio. En General, el formulario y Runtime ya no son dos cajas, con la de abajo apretada.
- **Barra de cambios sin guardar:** sin borde arriba; un tinte de aviso sube desde abajo y se pierde en la card, al revés que el de la cabecera. Discard y Save miden 44 px. Queda pegada al fondo de lo que hace scroll.
- **Tiers y Access:** los tiers pasan a píldoras de `--field-h` (antes cajas de 48 px). Las opciones de runtime, concurrencia y acceso usan `size="sm"`, sin `!h-auto`.
- **Instructions y Role and Permissions:** nuevo componente `SectionTabs`. Las secciones aparecen como pestañas a la izquierda y, a la derecha, título (h3 en mono), descripción y el control a todo el ancho (textarea de 14 filas). Las secciones con cambios llevan un punto. En móvil, las pestañas son una fila con scroll lateral.

**Usage:**
- "Updated …" y el botón de refrescar suben a la fila del título, en JetBrains Mono y un paso más pequeño.
- Para ese tamaño se añadió `text-2xs` (14 px) a la escala, en vez de escribirlo a mano.

**Elementos flotantes:**
- **Console se esconde como Agents:** `useIdleTuck` y `TUCKED_CLASS` salieron de `ShellChatButton` a `hooks/use-idle-tuck.ts`. Restart/Console se esconde a los 10 s y vuelve al pasar el cursor o al enfocarlo, cada uno con su propio reloj.
- **Comprobado en BER-511:** los dos se esconden y se apilan (Console abajo, Agents encima). El hover sobre Console solo hace volver a Console.
- **Las barras fijas abajo son el piso de la pila** (`FLOATING_ORDER.bar`, `useFloatingFloor`): `UnsavedChangesBar` y la nueva `BulkBar` (las barras de selección de Agents, el catálogo de agentes, Skills y el catálogo de skills, que antes repetían la misma clase). Mientras se ven, Agents y Console suben por encima y ya no tapan Save.

## Ajuste: los controles en línea a 40 px (2026-11-18)

Después de ver la prueba a 44 px, el usuario pidió bajarla un poco. `--field-h` queda en 40 px (`2.5rem`), entre los 32 de antes y los 44 del botón suelto. No hizo falta tocar ningún componente, porque todos toman la altura del token.

Solo cambió una cosa: el textarea de los compositores (comentarios y Post update) calcula su relleno a partir de `--field-h` (`py-[calc((var(--field-h)-1.25rem)/2)]`). Así mide lo mismo que sus botones con cualquier valor del token.

## Prueba: todos los controles en línea a 44 px (2026-11-18)

El usuario pidió poner a 44 px los controles que comparten línea (antes 32) para ver cómo queda. Es una prueba: si no convence, basta con volver `--field-h` a `2rem` en `app/globals.css`.

**El token:**
- `--field-h` pasa de 32 a 44 px. Lo usan `Input`, `SelectTrigger` y `selectTriggerClass`, `Button` `sm`/`icon-sm`, `TabsList` y `SegmentedControl`.
- Las cabeceras de grupo (Tasks en lista y tablero, Reviews) toman la misma altura. A 36 px, el botón "+" de 44 no cabía.

**Lo que no seguía el token:**
- **Editor de Loops:** usaba su propio `insetFieldClass` de 32 px. Ahora usa `Input`, `SelectTrigger` y `selectTriggerClass`, y sus segmentos comparten `segmentTrackClass` con `SegmentedControl`.
- **`variant="track"`:** forzaba la altura pero no el ancho, así que los botones de icono quedaban ovalados (32×44). Ahora es solo color, y cada botón lleva `icon-sm` (icono) o `sm` (con texto). Afecta al filtro, Display, Insights, Profile y Properties.
- **Botones `xs`/`xxs` en filas:** pasaron a `sm`. Son Retry (Loops), Add (los dos catálogos), Add tasks (ciclo), Add label (skill) y New view (Views).
- **Views:** las pestañas Issues/Projects estaban hechas a mano. Ahora son `SegmentedControl`.
- **Compositores:** sub-tareas pasó de 48 a 44 px. Comentarios y Post update pasaron de 32 a 44: los botones son `icon-sm` y el textarea arranca en `--field-h`.
- **Opciones del agente** (runtime, nivel, acceso): pasaron de 49 a 44 px.
- **Selector de página de Settings en móvil:** pasó de 28 px a `selectTriggerClass`.
- **Alturas fijas sin efecto:** se borraron 30 `h-7`/`h-8` en `Input`/`SelectTrigger` y 4 en `TabsList`. El mínimo `--field-h` ya los anulaba; solo confundían.

**Medición:**
- `probe-inline.cjs` con `TOL=0`, en todas las rutas a 1440 y 390: ninguna línea mezcla alturas.
- Un censo de controles con borde o relleno que no miden `--field-h` solo deja contenido, no controles:
  - las sugerencias de Chat y del nuevo Loop (chips de texto que se parten en varias líneas);
  - los chips de label (20 px).
- **Pendiente de decidir:** siguen 143 botones `xs`/`xxs` en sitios densos que no comparten línea con campos (badges, cabeceras de panel, acciones de tarjetas). No se tocaron en esta prueba.

## Controles de Settings en los componentes compartidos (2026-11-18)

Settings tenía controles propios: campos y selects rectangulares, una búsqueda con borde, un switch y un checkbox con otra forma, y alturas escritas a mano (30, 26 y 44 px). El usuario decidió que todo use la forma del resto de la app, en píldora, y que los controles que comparten línea midan 32 px.

**Componentes compartidos:**
- **`Button`:** `size="sm"` pasa de 30 a 32 px (`--field-h`). Se añaden `icon-sm` (32 px, cuadrado) y la variante `quiet-destructive`.
- **`Input`:** tiene las variantes `search` (la búsqueda rellena; sustituye a `searchFieldClass`) e `inline` (el nombre que se edita en su fila). También acepta `size="lg"` (44 px).
- **`Select`:** exporta `selectTriggerClass`, que `SelectMenu` y los selects hechos a mano usan. El trigger mide exactamente 32 px; antes medía 33.
- **Variantes `settings` eliminadas:** se quitaron de `Input`, `Textarea`, `Switch` y `Checkbox`.

**Settings:**
- `SettingsSearch`, `SelectMenu` y `SettingsIconButton` están montados sobre los componentes compartidos. `SETTINGS_PILL` ya no existe.
- Los botones de las filas llevan `size="sm"` (42 botones). Los pies de formulario y de diálogo y las acciones principales (Invite, Create key) siguen en 44.
- La regla quedó escrita en `docs/design-system.md` (Spacing and sizing).

**Medición:**
- `probe-inline.cjs` acepta ahora `TOL` (la tolerancia en px). Con `TOL=0`, las 19 pantallas de Settings salen sin diferencias a 1440 y 390 px.
- Solo aparecen dos casos que no son controles visibles: la muestra de color de los labels y la zona de clic invisible de la cabecera de cada tier.

**Barras de filtros (segundo commit):**
- Se quitó `[&_button]:!h-[30px]` de las 12 barras. Cada control mide ahora lo que dice su `size`:
  - el filtro (`track`), las pestañas y el control segmentado miden 32;
  - el menú de Inbox, el botón de refrescar de Usage y el filtro de proyecto de Usage pasaron a `icon-sm`/`sm`.
- Ya no hacían falta los `!h-[26px]` de `TabsTrigger` y `SegmentedControl`, que solo existían para ganarle a esas barras. Se quitó también la talla `md` de `SegmentedControl`, que nadie usaba.
- Logs, el editor de horario de Loops y los días del trigger dejaron de escribir 30 px a mano.
- **Medición:** con `TOL=0`, Inbox, My tasks, Projects, Cycles, Tasks, Agents, Skills, los dos catálogos, Connect, Usage y Views salen sin diferencias en sus barras, a 1440 y 390 px.

**Filas de lista (tercer commit; el usuario pidió igualarlas también):**
- **Botones de icono a 32 px (`icon-sm`):** `PickerIconButton` (prioridad y estado en las filas y los paneles), el "+" de los grupos de tareas, el menú de las tarjetas de Loops, el menú de los comentarios, "Add reaction", el borrar de los hitos y la muestra de color de los labels.
- **Botones con texto a 32 px (`sm`):** el asignado de las filas, las reacciones, Reply/Resolve y la fecha de los hitos.
- **Filas de Projects:** Health, Lead, la fecha, el estado y Cancel en Runs eran `size="sm"` con un `h-7` o `h-8` a mano. Se quitó ese añadido.
- **Chat:** el chip de modo, el título y los botones del compositor miden 32 (`--field-h`) y son píldora. El menú de la cabecera ya no sube a 44 en el teléfono.
- **Reviews en el teléfono:** la flecha "All reviews" mide 44, como Accept y Decline, que comparten su línea.
- **Sonda:** los switches quedan fuera de la medición, igual que los checkboxes. Se dibujan por debajo de la altura de control a propósito.
- **Medición:** con `TOL=0` en todas las rutas, a 1440 y 390 px, solo queda la cabecera de los grupos de Tasks. Es el área de clic de toda la cabecera (36 px) junto al "+" (32), no una caja visible.

**Aviso de datos:** a las 01:45:56 UTC del 19 de noviembre (19:45 hora local), una sola actualización en bloque asignó todas las tareas del tablero a Liam Novak. Los scripts de medición solo leen páginas, no hacen clic. No se pudo saber quién la hizo, porque la API no registra las peticiones.

## Espacio al final de Settings (2026-11-18)

Cada pantalla de Settings (`SettingsShell` en `components/common/settings/shared.tsx`) terminaba con `pb-24`, es decir, 96 px vacíos tras el último bloque. El detalle de un plugin dejaba 64 px (`pb-16`).

- **Teléfono:** baja a 32 px (`pb-8`). La barra de pestañas está fuera del área que se desplaza, así que no hace falta más.
- **Desde `md`:** queda en 70 px (`md:pb-[var(--shell-launcher-room)]`), la misma regla que las listas. Es lo justo para que la última fila no quede debajo del botón flotante de Agents. Ese botón se encima a la columna de Settings a 800 y 1024 px de ancho.
- **Medición:** `scripts/probe-settings-bottom.cjs`. Se probaron 19 pantallas a 1440, 800 y 390 px: 32 px en el teléfono y 70 px en escritorio en todas las que tienen desplazamiento.

## Barras de búsqueda y filtros en el teléfono (2026-11-18)

Pedido del usuario: el buscador de Tasks no medía lo mismo que los botones de al lado, y en Projects el buscador y los filtros quedaban mal acomodados. Sonda `probe-toolbar.cjs <tag> [anchos] [filtro]` (alto de cada control, cuántas líneas ocupa la barra y si algo se sale o se encima); capturas en `scripts/toolbar/`.

**Causa del alto:** `65b6409b` (M5.9) añadió `[@media(hover:none)]:min-h-6` a `searchFieldClass`; en táctil esa regla ganaba al `min-h-(--field-h)` (32 px) del `Input`, y todos los buscadores de barra bajaron a 24 px en el teléfono. Se quitó en `56f0488d`: el campo ya supera los 24 px táctiles.

**Análisis de las 10 pantallas con buscador** (390/360, tras corregir el alto):

| Pantalla | Qué pasaba | Arreglo |
| --- | --- | --- |
| Tasks | Buscador 24 px junto a botones de 32. A 360 el selector de vista bajaba a una segunda línea y quedaba **tapado por la lista** (la barra tenía `h-[48px]` fijo) | `8a770279`: en el teléfono, buscador a todo el ancho en la primera línea; filtro y opciones a la izquierda y selector de vista a la derecha en la segunda. `min-h` en lugar de `h` |
| Projects | El selector de vista (3 opciones) quedaba solo en una segunda línea, pegado a la derecha | Igual que Tasks (`8a770279`) |
| Cycles | Buscador de 32 px junto a "New cycle" de 44 px en el encabezado | `8a770279`: en el teléfono el buscador mide 44 px |
| Loops | Igual que Cycles, junto a "New loop" | Igual (`8a770279`) |
| Agents, Skills | Buscador + Filter en una línea y pestañas All/Archived en otra, a la izquierda | Bien acomodado; sin cambio |
| Agent catalog, Skill catalog, Connect | Buscador a todo el ancho y el resto debajo (M5.5) | Intencional; sin cambio |
| Milestones | Redirige a Projects | — |

- Resultado: todos los controles de cada barra miden lo mismo en el teléfono (32 px, o 44 px en Cycles y Loops), sin solapes ni desbordes a 390 y 360. A 820 y 1440 las capturas son idénticas byte a byte a las de antes.
- Cycles y Loops en escritorio: resuelto después, ver la regla de abajo.

**Regla del usuario (2026-11-18): los controles que comparten línea miden lo mismo, también en escritorio.** Sonda `probe-inline.cjs <tag> [anchos] [filtro]`: en las 45 rutas y 6 detalles, agrupa los controles alineados de una misma fila flex y marca las que mezclan alturas (log en `scripts/toolbar/inline-before.log`).

- **Arreglado en `5bf0443a`:** Cycles y Loops (buscador a 44 px como el botón de crear, en todos los anchos); Usage (filtro de proyecto 44 → 32 y Refresh 30 → 32, como el rango y las pestañas); Settings → Logs (Refresh 30 → 32 junto a los selects de 33; `!h` porque `Button` no fusiona clases con tailwind-merge y `h-[30px]` de `sm` ganaba); detalle de Loop (menú "⋯" 30 → 44 como Run now y Save). Verde a 1440 y 390.
- **Pendiente de decisión — formularios de Settings** (campo de 30–32 junto a botón de 44): General (Task prefix / Change prefix), Members (rol / Remove, en cada fila), Issue y Skill labels (nueva etiqueta / Create; y el filtro de 23 junto a New label), Issue properties (nombre y tipo / Add field), Shortcuts (buscador de 23 / Restore defaults), Connected accounts (canal y correo / Add). `globals.css` fija a propósito los campos en 32 y los botones en 44.
- **Sin tocar — iconos en filas de lista:** prioridad y estado 28 junto al responsable 24 (Tasks, detalle de proyecto); cabecera de grupo 36 junto a "+" 28; en etiquetas, punto de color, Rename 26 y Remove 28; en comentarios, reacción 28 junto a Reply/Resolve 24. Detalles menores: el selector de modo del chat (24) junto a Send (32), "All reviews" (28) junto a Accept/Decline (44) a 390.

## Túnel con build de producción (2026-11-18)

- **Arreglos pequeños de la Fase 5:** `65b6409b` (buscadores, miga "Cycles" y márgenes de checkbox en táctil) y `1aebab29` (cabeceras para ordenar en Skills y Agents a 24 px en táctil; medido 23,2 → 24 a 390, 1440 igual).
- **Build:** en el worktree `E:\projects\work\berry-integration`, puesto en `1aebab29` sin rama (`git checkout --detach`; la rama `integration/mobile-next` no se tocó). `NEXT_DIST_DIR=.next-prod BERRY_API_ORIGIN=http://127.0.0.1:4100 NEXT_PUBLIC_AUTO_LOGIN_EMAIL=prototype@berry.test next build`, servido con `next start -p 3300 -H 127.0.0.1`.
- **Túnel:** `cloudflared` portátil 2026.11.1 (firmado por Cloudflare) en el scratchpad: `cloudflared tunnel --no-autoupdate --url http://127.0.0.1:3300`. La URL cambia en cada arranque.
- **API reiniciada con permiso del usuario (15:12):** ahora confía en `https://*.trycloudflare.com` (se añadió a `BERRY_AUTH_TRUSTED_ORIGINS` en el comando de abajo). Por el túnel ya se puede escribir: un PATCH sin cambios a `/api/v1/me/settings` responde 200 (`tunnel-write-check.cjs`). Al detenerla a la fuerza, PGlite no volvía a arrancar ("could not open directory pg_notify"): a `berry-db/pg` le faltaban las carpetas vacías de Postgres (`pg_notify`, `pg_stat`, `pg_tblspc`…). Se recrearon vacías y arrancó con los datos intactos (174 tareas). Copia previa en `berry-db-backup-1518`, junto a `berry-db`.
- **Inbox, "Archive" fuera de la pantalla (`4d81644b`):** al abrir una tarea desde Inbox, el panel de detalle medía 440 px a 390 y 360 (flex sin `min-w-0`), con "Archive" y el composer fuera de la vista y scroll lateral. Con `min-w-0`: "Archive" en 270–368 a 390 y 240–338 a 360, sin desbordes; 820 y 1440 iguales (`probe-inbox-archive.cjs`, capturas en `scripts/inbox-archive/`). El túnel sirve ya ese commit (`.next-prod2`).
- **"Draft saved" en el borde del composer (`173e551c`):** la línea reservada bajo el campo de comentario (`min-h-7`) dejaba unos 44 px entre el campo y la barra inferior. El rótulo va ahora sobre el borde superior derecho del campo, como una leyenda; la línea de abajo solo aparece con la nota o los agentes que se van a despertar. Medido a 390/360/1440: 12 px del campo al borde de su zona, el campo no se mueve al escribir (`probe-draft.cjs`, capturas en `scripts/draft/`). El túnel sirve ya ese commit (`.next-prod3`).
- **Medido por el túnel** (`nav-timing-tunnel.cjs`, Chrome sin interfaz desde la PC): primera carga hasta el shell 0,9–1,5 s; cambio de sección (URL) 75–150 ms, con la página asentada en 0,4–1,1 s según las llamadas a la API. La primera visita a Projects tarda ~1 s porque dispara 26 llamadas.

## Fase 5 (2026-11-18): completa (M5.1–M5.8), pendiente de revisión

Misma forma de trabajo (Sonnet, una tarea por commit). Sondas `probe-m51`, `probe-m56`, `probe-m57`, `probe-m58` y `probe-m5x.cjs` (M5.2–M5.5); capturas en `scripts/m51`, `m56`, `m57`, `m58`, `m5x`.

| Tarea | Qué | Commit | Puerta |
| --- | --- | --- | --- |
| M5.1 | Zonas táctiles de 24 px solo en `(hover:none)`: checkbox (caja visible dibujada con `::before`), manija de tiers, puntos de color de etiquetas, enlaces de fila con `min-h-6`, avatar del responsable | `ccd41395` | Verde. Controles < 24 px a 390: Skill catalog 502 → 1, Skill labels 97 → 1, Agent catalog 89 → 1, Tasks 144 → 0, Skills 66 → 1, Projects 18 → 0, Model tiers 12 → 0, Cycle 13 → 1. 1440 igual. Queda: el buscador de 23 px (`settings/shared.tsx`, `ui/input.tsx`), la miga "Cycles" del drawer, y 2–3 px de desplazamiento en táctil en el checkbox del import de GitHub y del menú de filtros |
| M5.2 | Reviews: `break-words` y filas a 14 px en el teléfono | `58b7a33a` + `47be108b` | Verde. Textos < 14 px 45 → 0 a 390/360; 1440 igual |
| M5.3 | Inbox: el identificador una sola vez (venía también en el título del servidor; pasaba también en escritorio) | `1f10d6ac` | Verde a las 4 anchuras |
| M5.4 | Agent catalog: barra con título y vuelta a Agents en el teléfono (`md:hidden`). Plans ya no existe | `b519dc9d` | Verde; 1440 igual. La raya inferior de la barra queda un poco metida a la derecha |
| M5.5 | Buscadores de catálogos e integraciones a todo el ancho en el teléfono; nombre del tier entero ("XHigh") | `fef04a3e` | Verde a 360 |
| M5.6 | Sin atajos de teclado en táctil (`ContextMenuShortcut`/`DropdownMenuShortcut`, "⌘↵" de loops e hitos). Menús contextuales con `collisionPadding` 8 y ancho limitado; por debajo de 640 px el submenú se monta 80 px sobre el menú padre | `2d54c6e3` | Verde. Margen derecho de los 7 submenús de −50…−144 → ≥ 20 a 390/360; 1440 igual |
| M5.7 | Título en la vista de tabla: tocar el título abre la tarea, donde el título se edita con un toque. Solo se documenta | `181a143c` | Verde (comprobado a 390/360) |
| M5.8 | Sign-in: el marco y el logo siguen el fondo oscuro (también en escritorio, era un fallo) | `64c702e3` | Verde. Marco rgb(244,244,245) → rgb(17,17,19); logo visible |

**Puerta de la Fase 5:**
- `build:check` compila; el type-check falla solo por `.next/dev/types/validator.ts` viejo (6 errores, todos ahí).
- `mobile-audit2` a 390/320 frente a la Fase 4: 45/45 rutas; mejor 12, "peor" 3, todos por datos: `d-project` eligió otro proyecto (con lista de tareas y sus `sr-only`), `d-loop` esta vez sí abrió el loop (antes redirigía), y el chat tiene un mensaje más (un botón Copy más). `my-tasks` a 320 solo suma `sr-only`.
- Teléfono conectado por adb en `192.168.100.2:36177` (`phone-lib.cjs` actualizado).

## Fase 4 (2026-11-18): completa (M4.1–M4.6), pendiente de revisión

Decisiones del usuario: **D2 = rail fijo a partir de `md`** y **D3 = solo "Mover a…"** (sin arrastre táctil). Misma forma de trabajo (Sonnet, una tarea por commit). Sondas `probe-m41`…`probe-m45.cjs`, capturas en `scripts/m41`…`scripts/m45`.

| Tarea | Qué | Commit | Puerta |
| --- | --- | --- | --- |
| M4.1 | Lanzador sobre el velo del menú | — | Sin cambio: por debajo de la barra el lanzador no se monta y el velo queda encima (4/4 combinaciones). La barra inferior ya era M1.4 |
| M4.2 + b | Rail fijo desde `md` (D2): barra inferior, velo, lanzador y relleno del lienzo pasan de `lg` a `md`. `useIsShellOverlay`/`SHELL_BREAKPOINT` (768) para el shell; `useIsMobile` sigue en 1024 para las páginas. b: el drawer resta el rail y las listas dejan sitio al lanzador también entre 768 y 1023 | `86d0de5b` + `3aea1d72` | Verde. A 820/768: rail en columna 0–232, sin barra inferior, lanzador visible, sin desbordes. 390 y 1440 idénticos. `split-index` sigue en `lg` (40 % de lista junto al rail sería estrecho) |
| M4.3 | `themeColor` claro/oscuro y `--app-inset-l` = `max(6px, env(safe-area-inset-left))` | `de634841` | Verde. Márgenes 0/6 → 6/6 a 390 y 360; 1440 igual. `viewportFit: 'cover'` y el resto de safe areas ya estaban |
| M4.4 | Teclado: `interactiveWidget: 'resizes-content'`, diálogo de nueva tarea con `dvh`, título con `enterKeyHint="next"` y `autoComplete="off"`, y el composer de loops se desplaza a la vista al encogerse | `40edc4e7` | Verde a 390×508: "Draft loop" fuera de la vista → tocable; "Create task" y los dos Send tocables |
| M4.5 | "Mover a…" (D3): ⋯ en las tarjetas del tablero de tareas solo en táctil, submenú con las columnas y la misma escritura que soltar; en proyectos el submenú de estado se llama "Move to…" en el tablero | `8975305b` | Verde en táctil a 390: tarea Backlog → Todo y vuelta; proyecto Planned → Active y vuelta. El scroll lateral sigue. Datos restaurados (la tarea vuelve al final de su columna) |
| M4.6 | Indicador de Next | — | Sin cambio: `devIndicators: false` ya estaba |

**Puerta de la Fase 4:**
- `build:check` compila; el type-check falla solo por `.next/dev/types/validator.ts` viejo (rutas de Plans), que es del servidor de :3000 y se regenera al reiniciarlo.
- `mobile-audit2` a 390/320 frente a la Fase 2 (no hay pasada guardada de la Fase 3): 45/45 rutas; mejor 5–6, "peor" 4–5, todos explicados: `plans` y `d-loop` redirigen (Plans retirado, el loop de prueba ya no existe); `tasks` y `d-cycle` suben `cut`/`small` por textos `sr-only` intencionados (M3.1, M3.7) y enlaces de 23 px de alto que ya existían (M5.1); `runs` a 320 son las tarjetas de M3.2. Logs en el scratchpad: `gate-f4-390.log`, `gate-f4-320.log`.
- Python no está instalado: `check-locale-catalogues.py` sin correr (el JSON parsea y las claves existen).

**Pendiente para el teléfono real:**
- Android: que `resizes-content` encoja de verdad el viewport (Create task, Draft loop, Send).
- iPhone: ignora `interactiveWidget`; comprobar que el composer y los botones siguen a la vista (quizá haga falta `visualViewport`). Safe areas reales con muesca.
- El ⋯ de las tarjetas (32 px) y el submenú "Mover a…": a 390 los submenús del menú contextual se salen por la derecha (pasa en todos los submenús; va con M5.6).
- `theme-color` sigue a `prefers-color-scheme`, no al tema elegido en la app.

## Carga entre secciones (2026-11-18)

- `37fab28e`: `app/[orgId]/loading.tsx` (esqueleto de sección al hacer clic) y `ListSkeleton` (`components/common/page/page-skeleton.tsx`) en lugar de "Loading…" en 10 listas.
- `858f9625`: `loaded` en los stores de projects, runs y views; ya no muestran "No … yet" antes de cargar.
- Medido en build de producción (:3200/:3201, ya detenidos): el cambio de URL tarda 110–180 ms con o sin el cambio; con él, el esqueleto y el resaltado del menú aparecen a los 150 ms. La lentitud en :3100 es el servidor de desarrollo.
- Fase 3 (M3.2–M3.9) ya está fusionada y con push en `integration/mobile-next` (`5d081553`); estos dos commits todavía no.
- Scripts: `nav-timing.cjs`, `nav-peek.cjs`, `reload-peek.cjs`, `api-list.cjs`.

## Fase 3 (2026-11-17, noche): completa (M3.1–M3.9), pendiente de revisión

**M3.9 (D4 = el chat sigue el tema), `09f425b5`:**
- **Por qué medía 12 px:** el atributo `data-step-body="prose"` de las transcripciones de runs estaba en las respuestas y en la raíz del chat flotante.
- **Tamaño:** la nueva regla `[data-chat-reply]` pone respuestas y burbujas a 16 px.
- **Tema:** `data-chat-surface` en la raíz del chat de página y del flotante. La rampa clara se aplica ahora a `:is([data-shell-chrome], [data-chat-surface])`.
- **Medido en light:** texto rgb(24,24,27) sobre blanco, contraste 17.7.
- **Medido en dark:** colores idénticos a antes.
- **Sin probar en light:** bloques de código, tablas y tarjetas de trabajo delegado (no hay datos de prueba).


Misma forma de trabajo (Sonnet, una tarea por commit, puerta con `tsc`). Las sondas son `probe-m31`…`probe-m38.cjs`, con capturas `m3x-*` en `scripts/`.

| Tarea | Qué | Commit | Puerta |
| --- | --- | --- | --- |
| M3.1 | Fila de tarea: solo el avatar del responsable por debajo de `sm` (`AssigneeUser` gana `nameClassName`) | `a7d15ef0` | Verde. Título mínimo visible 9 → 20 caracteres a 390 y 5 → 20 a 360; 1440 idéntico |
| M3.2 | Runs en tarjetas por debajo de `md` (como Logs en M2.5) | `ca3edc16` | Verde. 16 tarjetas a 390/320, sin solapes y `off` 0; tabla igual a 1440 |
| M3.3 | Vistas: el dueño solo con avatar por debajo de `sm` | `3cb74fe9` | Verde. Nombre 72 px truncado → 184 px completo a 390; 1440 idéntico |
| M3.4 + b | Loops: KPIs en una fila con etiquetas que se doblan (`wrap` opcional en `PageKpiHeader`) y filas de "need attention" que se doblan | `50b1e95a` + `84158973` | Verde. `off` 1 → 0; nombres de 3 caracteres → completos. A 320, "attent/ion" se parte a media palabra |
| M3.5 | Cycles: etiquetas de estado que se doblan, y línea de tiempo y tabla con scroll propio y degradado | `10e843ed` | Verde. El `off` 5 a 390 es el contenido de los scrollers; la página no se desplaza a lo ancho |
| M3.6 | Tarea: miga de una línea, sub-tareas apiladas, relleno bajo la actividad para Console y fila de actividad dentro del ancho | `c7918e0b` | Verde. Queda `off` 1 (el título truncado del encabezado, falso positivo). Console sigue flotando sobre la actividad con scroll arriba. Sin datos con sub-tareas |
| M3.7 + b | Drawer de ciclo: Activate/Remove en un menú "⋯", zona táctil del enlace de vuelta, × junto al avatar sin taparlo, estado como punto y títulos con sitio | `0f5028ff` + `2507413a` | Verde. Títulos 2 → 20 caracteres a 390 y 16 a 360; solape × / avatar 0. Nueva cadena `cycles.detail.moreActions` |
| M3.8 | Agente: aviso de runtime que se dobla, pestañas con degradado y la activa a la vista, tiers apilados | `b4312217` | Verde. `off` 2 → 1 (la lista de pestañas, dentro de su scroller); nombres de tier completos |

**Puerta de la Fase 3:**
- `tsc`: solo el error de partida.
- `eslint` sobre los 16 archivos tocados: solo el aviso previo de `activity-feed.tsx`.
- Prueba de humo (`smoke-integration.cjs`, ahora con Loops y Cycles): 13 rutas a 390 y 1440, todas 200.

**Teléfono real (antes de M3.2, sobre `integration/mobile-next`):** todo verde, igual que en la Fase 1. Quedan "Create task" y "Draft loop" bajo el teclado (ya en M4.4). El Galaxy está ahora en `192.168.100.2:37973` (actualizado en `phone-lib.cjs`).

**Siguiente:** revisión del usuario de la Fase 3, D4 para M3.9 y llevar M3.2–M3.8 a `integration/mobile-next`.

## Integración fix/mobile + Next 16.4.6 (2026-11-17, noche)

- **Ramas:**
  - `chore/next-16.4.6` (`81737846`, worktree `E:\projects\work\berry-next`) tiene la subida de Next sobre `main`.
  - `integration/mobile-next` (`b4b90bf4`, worktree `E:\projects\work\berry-integration`) es `fix/mobile` + `chore/next-16.4.6`.
  - Las dos son locales y sin push.
  - Fusionar trae también 23 commits de `main`, entre ellos la retirada de Plans.
- **Conflictos resueltos (14):**
  - Plans: se toma su retirada de `main` y se quitan las historias huérfanas, la entrada de la paleta y la fila Plans del menú More.
  - Tarjetas del tablero: tokens de `fix/mobile`.
  - Tipografía del detalle: la regla combinada de `fix/mobile` más las reglas de etiqueta, comentario y actividad de `main`.
  - Plugins: la agrupación por categoría de `main`.
- **Resultado:**
  - `tsc` y `build`: solo falla el error de partida de `shell-launcher-dock.tsx:21`; el build compila.
  - `typecheck:server` y plugin-sdk: verdes.
  - `test:server`: 61 fallos, los mismos que en `chore/next` (61) y en `fix/mobile` (62). Son de entorno: adaptadores de CLI, Docker y sandbox en Windows. Ninguno es nuevo.
  - Lint: solo el error previo de `session-gate.tsx`.
  - Prueba de humo (`scripts/smoke-integration.cjs`) a 390 y 1440: 10 rutas más una tarea, todas 200 y sin errores de página. `/plans` da 404, que es lo esperado.
  - La fila de actividad que se sale en BER-511 (390) ya estaba en `fix/mobile` y va a M3.6.
- **:3100** vuelve a servir `fix/mobile`.

## Fase 2 (2026-11-17, tarde): completa, pendiente de revisión del usuario

Tras la revisión de la Fase 1 hubo 5 ajustes del usuario (`0c737e00`…`163150aa`: safe areas, chat a pantalla completa, menús al tocar, píldora de la barra). Después, la Fase 2 con la misma forma de trabajo (Sonnet, una tarea por commit, puerta con `tsc`). Las sondas nuevas son `probe-m21`…`probe-m27b.cjs` en `scripts/`.

| Tarea | Qué | Commit | Puerta |
| --- | --- | --- | --- |
| M2.1 | Barras de filtros con `min-h-[48px]` (Projects, Agents, Logs) | `a3ac9e66` | Verde. Sin solape a 390/360; a 1440 la barra sigue en 48 px. *El servidor :3100 se rompió a media tarea (500 en `/berry/*`, "Jest worker…") y hubo que reiniciarlo* |
| M2.2 | Settings: `px-4` y filas con descripción apiladas por debajo de `sm` | `892fa762` | Verde. Una palabra por línea: 7 páginas → 0 (390) y 6 → 0 (360); 25 rutas idénticas a 1440 |
| M2.2b | Pestañas de Runtimes a 320 (`max-sm:px-2`) | `cf84bc21` | Verde. `off` 1 → 0 a 320; 1440 idéntico |
| M2.3 | Encabezado de Settings: nombre una vez, selector con elipsis, Organization/Repositories/Usage con nombre | `c87c2401` + `9ddb1d14` | Verde. A 1440 Organization y Repositories ganan su miga (intencional). *Pendiente:* el desplegable no lista Organization/Repositories/Usage (están fuera de `settingsNav`) |
| M2.4 | Members: nombre y correo en una línea con elipsis y `title` | `449fdf88` + `62eab057` | Verde. A 360 el correo ya no se parte; la puerta de fase vio enlaces de 23 px y se corrigió con `leading-6`. Sin correos largos en la base de prueba |
| M2.5 | Logs en tarjetas por debajo de `md` | `aa1c065c` | Verde. `off` 0 a 390/360; tabla igual a 820 y 1440 |
| M2.6a | Controles solo-hover visibles en táctil (ciclo, hitos, relaciones, loop, vistas, fecha) | `12474828` | Verde. 21 → 0 controles invisibles en táctil. *Decisión abierta:* en el drawer de ciclo la × tapa el avatar del responsable en el teléfono. Sin probar: quitar relación (no hay datos) |
| M2.6b | Ídem en chat, archivos, vista previa y fijados; zonas táctiles de 24 px con pseudo-elemento | `775da4b3` | Verde. Chat 2 → 0, More 4 → 0. Sin probar: lista de archivos y panel de vista previa (sin datos), copiar con un toque real |
| M2.7 | Perfil de miembro: Insights/Profile como capa por debajo de `lg`, empieza cerrado | `8eca0cde` | Verde a 390/820 |
| M2.7b | Proyecto: botones Insights/Properties en el encabezado por debajo de `xl` y panel como capa | `521aecac` | Verde. A 1280/1440 sin botones y panel en el mismo sitio |

**Puerta de la Fase 2:** `build:check` falla solo por `shell-launcher-dock.tsx:21`. `mobile-audit2` a 390/320 frente a la Fase 1: Logs `off` 1 → 0, Members y Runtimes corregidos en la puerta; Chat `cut` +1 (nombre de modelo truncado en el encabezado, no de esta fase).

**Hallazgos para después:** el botón Star del perfil no hace nada (sin `onClick` ni `aria-label`); en el perfil y el proyecto, Insights pulsado otra vez cambia a Properties en lugar de cerrar (comportamiento del store, igual que antes en escritorio).

**Siguiente:** revisión del usuario de la Fase 2; luego Fase 3 (M3.1–M3.9; M3.9 necesita D4).

## Dónde quedó (2026-11-17, cierre de la Fase 1)

- **Rama:** `fix/mobile`, local y sin push, creada desde `perf/boot-realtime` @ `ae4bcea3`. `main` no tiene 110 commits de los que dependen estos arreglos.
- **Árbol:** limpio. Solo quedan sin comitear `bun.lock` y `frontend/tsconfig.json`, que son tuyos, más `docs/ux-review/` y `frontend/.next-tunnel/`. Nunca se añaden al commit.
- **Forma de trabajo:** un subagente por tarea, un commit por tarea (`fix(frontend): … (BERR-00)` + `Co-Authored-By`), y una puerta del orquestador entre tareas:
  - `git status`;
  - diff dentro del alcance, sin borrados e historia intacta;
  - `bunx eslint <tocados>`;
  - la medición propia de la tarea.

| Tarea | Qué | Archivos | Commit | Puerta |
| --- | --- | --- | --- | --- |
| M1.1 | Composer del chat flotante libre del launcher | `floating-chat.tsx` | `50e12b9a` | Verde. Send/Agent tocables a 390/360 con y sin teclado; 1440 igual. **Verificado también en Android real** |
| M1.2 | × en los drawers por debajo de `lg` | `detail-drawer-shell.tsx`, `messages/en/shell.json` | `35b93322` | Verde. 44×52 en 7 drawers, vuelve a la lista; el de ciclo sigue con su ×; 1440 igual. **Android real: OK** |
| M1.3 | Search en el menú del teléfono | `command-palette.tsx`, `store/command-palette-store.ts` (nuevo), `shell-rail.tsx`, `shell.json` | `4c767b5a` | Verde. Abre la paleta con foco y cierra el menú; Ctrl+K en 1440 igual. **Android real: abre, pero ver M1.11** |
| M1.5 | Filas de "añadir" de Settings | `settings/shared.tsx` (`max-w-full` en el `trailing` de `SettingsRow`) | `58dee1e5` | Verde. Create link/Add en pantalla; 1440 idéntico en 9 páginas |
| M1.6 | Diálogo de nuevo proyecto y su asistente | `create-project-dialog.tsx`, `create-project/agent-draft-panel.tsx` | `2671144f` | Verde. Footer apilado y asistente a todo el ancho por debajo de `sm`; 1440 igual |
| M1.7 | Barra de vistas fijadas | `views/saved-views-bar.tsx` | `6a5b9541` | Verde en alcance. Por debajo de `sm`: 1 vista en línea, el resto en "More", y Manage/New solo icono. A partir de `sm`: zona con scroll lateral. `offCount 0` a 390/360/1440 y drawer `off 0`. **Regresión a 1440:** "Waiting for review" cortada en seco, sin pista. Va a M1.7b |
| M1.7b | Corrección: degradado también a partir de `lg`, relleno final, vista activa en línea en el teléfono | `views/saved-views-bar.tsx` | `5fca117a` | Verde. A 1440, "Waiting for r…" se desvanece y con scroll al final queda entera. En el drawer de "Open bugs" a 390, la vista en línea es la activa |
| M1.8 | `PageKpiHeader` compacto | `page/page-parts.tsx` | `d2a0bc87` | Verde. Por debajo de `sm` la fila se dobla y las acciones pasan a una segunda línea solo si no caben. A 390/360 todo es tocable en las 6 páginas; a 1440 los rects son idénticos. A 320 también cabe |
| M0.1 | `next dev` acepta orígenes extra (`BERRY_DEV_ORIGINS`) para abrirlo desde el iPhone por la red local | `next.config.ts` | `bee2a350` | Verde. Con la API y la web reiniciadas (ver abajo), `http://192.168.100.6:3100/berry/tasks` carga Tasks con sesión desde el Android por Wi-Fi |
| M1.9 | Selección múltiple en táctil + barra en bloque | `issues/selection-checkbox.tsx`, `issues/batch-toolbar.tsx` | `fc19a594` | Verde. En `(hover: none)` el checkbox tiene opacidad 1 y una zona táctil de 24×24; un toque marca sin abrir la fila. La barra se dobla y `offCount 0` a 390/360. A 1440: opacidad 0 hasta hover, igual que antes. *Hallazgo:* a 360 el selector lista/tablero queda montado sobre "Status" en la primera línea (va a Fase 3) |
| M1.10 | Panel de valores del filtro dentro de la pantalla | `data-table-filter/components/filter-selector.tsx`, `locales/en.json` | `24a2cec2` | En alcance y medido bien (a 390/360 valores en x 189–357, `allInView`; a 1440 rects idénticos). **La puerta encontró un bug:** `max-sm:shadow-nonemax-h-[…]` sin espacio, así que el panel pierde su altura máxima también en escritorio. Va a M1.10b |
| M1.10b | Corrección: separar `max-sm:shadow-none` y `max-h-[…]` | `filter-selector.tsx` | `49ff2bb7` | Verde. Una línea. A 1440 el panel de Assignee vuelve a `max-height: 384px`; a 390 sin sombra; `m110` igual |
| M1.11 | Paleta usable con el teclado (anclada arriba, sin pista Ctrl+Enter ni atajos en táctil) | `layout/command-palette.tsx` | `63f1b84e` | Verde. A 390/360 la paleta empieza en y = 8, 7 resultados por encima de y = 436, sin pista y sin chips; a 1440 idéntica |
| M1.4a | **Barra inferior** Inbox · Tasks · Projects · Agents · More por debajo de `lg`; quita el ☰ y la píldora Agents en el teléfono; `--shell-launcher-b`/`-clear` por encima de la barra | `shell/shell-tab-bar.tsx` (nuevo), `use-inbox-unread.ts` (nuevo), `berry-shell.tsx`, `shell-personal.tsx`, `globals.css`, `shell.json` | `57cff601` | Verde. Barra de 56 px; cinco pestañas tocables de 55 px a 390/360/820; `main` termina 8 px por encima de la barra; More abre el rail; Agents abre el chat, que termina en el borde de la barra, con Send tocable. A 1440 sin barra, píldora en el mismo sitio. `tsc` solo con el error de partida. *Pendiente de ver:* modo oscuro en el teléfono, contador de Inbox algo grande, y Restart/Console (no aparecen en los datos de prueba) |
| M1.4b | "More" llega a Chat, Plans, Views, Runs y Settings (sección `lg:hidden` en el rail) | `shell/shell-rail.tsx`, `shell.json` | `038f37cf` | Verde. A 390 las 5 filas tocables; cada una navega (Chat → `/berry/chat?session=…`, Settings → `/berry/settings/preferences`) y cierra el menú; `aria-current` en la activa. A 1440 `display: none` |
| M1.4c | Corrección de tipos: `as const` en las etiquetas de la sección More (`tsc` TS2345 que dejó M1.4b) | `shell/shell-rail.tsx` | `02397771` | Verde. `tsc` vuelve a dar solo el error de partida. *Lección:* la puerta de cada tarea corre también `tsc --noEmit` |

**Rojo de partida, no de esta fase:** `tsc` falla en `frontend/components/layout/shell/shell-launcher-dock.tsx:21` (el `useEffect` devuelve `() => string`). Viene del commit `965ce3ac`, que ya está en `perf/boot-realtime`. Hasta arreglarlo, el `build:check` de fin de fase va a fallar. Es una línea (llaves en el cleanup), pero falta preguntarle al usuario dónde arreglarlo.

## Puerta de la Fase 1

- `build:check`: falla solo por el error de partida de `shell-launcher-dock.tsx:21` (después de M1.4c).
- `mobile-audit2` a 390 frente a la pasada inicial:
  - `off` baja en Cycles, Agents, Skills, Views, Members y Connected accounts.
  - `cut` sube 1 en todas las rutas por el `sr-only` "Inbox, 25 unread" de la barra. Es texto para lectores de pantalla, no algo recortado a la vista.
  - En Views suben 3 por las etiquetas `max-sm:sr-only` de More/Manage/New.
  - `small` sube en Tasks (73 → 124) porque el checkbox de 14 px ahora se ve en táctil; su zona táctil de 24 px es un pseudo-elemento que la pasada no mide.
  - El drawer de tarea se midió antes de terminar de navegar (coincidió con `build:check`). Repetido solo: `cut 3`, `small 0/18` y `off 2`; el `off` nuevo es una fila de actividad más ancha que el drawer (va a M3.6).
- **Android real (Galaxy A14, 411×821, toques y teclado reales con `phone-f1.cjs` y `phone-more.cjs`):**
  - **Barra:** 5 pestañas de 82×56 tocables; Projects navega y marca `aria-current`.
  - **Chat con teclado:** el composer y Send siguen visibles y tocables.
  - **Paleta con teclado:** 6 resultados visibles, sin pistas de teclado ni `kbd`.
  - **Selección:** el checkbox se ve (opacidad 1). Tocarlo marca la tarea sin abrirla. La barra de acciones pasa a 2 filas y todos sus botones son tocables.
  - **Filtro:** "← Back" y los 7 estados caben y son tocables.
  - **Encabezados:** "New cycle" cabe.
  - **Views:** el selector, Manage y + caben. La prueba no los encontró porque buscaba texto que en el teléfono va como `sr-only`; la captura confirma que están.
  - **More:** con un deslizamiento real, el menú llega a Plans, Views, Runs y Settings, todos tocables. La primera medición solo falló porque el script buscaba el scroll dentro de `#shell-rail` en vez de en `#shell-rail` mismo.
  - **Hallazgo:** con el teclado abierto, Chrome deja la barra inferior pegada encima del teclado. Se come 56 de los 500 px visibles. Lo habitual es ocultarla mientras se escribe.
  - **Hallazgo:** More lista "Agent" (`nav.chat`, ya existía) unas filas debajo de "Agents" en Manage. Son cosas distintas con nombres casi iguales.
  - Capturas en el scratchpad de la sesión: `phone-f1-out/`.

## Hallazgos de los subagentes, para tareas posteriores

- **M1.1:** por debajo de `sm`, la ventana del chat termina con un borde recto unos 78 px por encima del fondo, y se ve una franja de página entre ella y los botones.
- **M1.2:** el breadcrumb de la tarea se trunca más ("BER-51…"; va a M3.6). En el drawer de vista, el × le quita ancho a la barra de chips (M1.7). El foco inicial ahora cae en el ×. Si la consola de runs está abierta, el × queda solo en una fila de 40 px.
- **M1.3:**
  - En el teléfono se ve "Ctrl+Enter opens in a new tab" y el resaltado de coincidencias tiene huecos ("Mem ber s").
  - Las stories de la paleta siguen abriéndola con ⌘K.
- **M1.5:** los correos largos quedan pegados a Remove/Revoke. Las filas de Members son estrechas (M2.4) y el selector de la cabecera de Settings se corta (M2.3).
- **M1.6:**
  - "Hide" del asistente mide 28 px.
  - El textarea del asistente tiene autofocus, así que en el teléfono saca el teclado al abrirse.
  - Entre 640 y 1023 px el formulario queda estrecho al lado del panel de 400 px.

## Cómo retomar

### Servidores de prueba

Nunca la base de desarrollo ni los puertos 3000/4000.

- **API en `:4100`:**
  ```bash
  S=C:/Users/eduvc/AppData/Local/Temp/claude/3cd47944cd944701/035a560b-23fe-450f-923b-21a34cf61b9a/scratchpad
  cd server-ts && INTEGRATION_ENCRYPTION_KEY="$(cat $S/integration-key.txt)" DATABASE_URL="pglite:$S/berry-db" API_ADDR=127.0.0.1:4100 BERRY_AUTH_TRUSTED_ORIGINS="http://localhost:3100,http://192.168.100.6:3100,https://*.trycloudflare.com" node --env-file-if-exists=../.env --experimental-strip-types src/index.ts
  ```
  Si quedó un `berry.lock` de una sesión anterior, se borra antes de arrancar. Si PGlite falla con "could not open directory pg_…", se recrean vacías las carpetas que falten en `berry-db/pg` (`pg_commit_ts pg_dynshmem pg_notify pg_replslot pg_serial pg_snapshots pg_stat pg_stat_tmp pg_tblspc pg_twophase pg_logical/snapshots pg_logical/mappings pg_wal/archive_status pg_wal/summaries`).
- **Web en `:3100`:**
  ```bash
  cd frontend && NEXT_DIST_DIR=.next-tunnel BERRY_API_ORIGIN=http://127.0.0.1:4100 NEXT_PUBLIC_AUTO_LOGIN_EMAIL=prototype@berry.test NEXT_TELEMETRY_DISABLED=1 BERRY_DEV_ORIGINS=192.168.100.6 node node_modules/next/dist/bin/next dev -p 3100
  ```
  Ya no hace falta el stub de `@swc/core`: Smart App Control está apagado. Si Next se cierra tras mostrar su aviso de actualización, se relanza el mismo comando; ese aviso no se sigue.

### Desde el iPhone (u otro teléfono en la misma Wi-Fi)

- Dirección: `http://192.168.100.6:3100/berry/tasks` (IP de la PC por Ethernet; si cambia, `Get-NetIPAddress` y actualizar las dos variables de arriba).
- Hace falta que la API confíe en ese origen (`BERRY_AUTH_TRUSTED_ORIGINS`) y que `next dev` lo admita (`BERRY_DEV_ORIGINS`, commit `bee2a350`). Sin lo segundo, Next responde 403 y la app se queda en "Loading Berry".
- Login automático con el usuario de prueba; base de prueba.

### Mediciones

En [`scripts/`](scripts/):
- `probe-m11.cjs` (chat), `probe-m12.cjs` (drawers), `probe-m13.cjs` (Search);
- `probe-m157.cjs <out> m15|m16|m17` (Settings, nuevo proyecto, vistas);
- `probe-m1810.cjs <out> m18|m19|m110` (encabezados, selección, filtro);
- `probe-m14.cjs <out>` (barra inferior: pestañas, `main` frente a la barra, More, chat);
- `probe-m111.cjs <out>` (paleta con el teclado del Android simulado: resultados por encima de y = 436);
- `mobile-audit2.cjs` y `mobile-validate.cjs` para las pasadas completas.

Las mediciones de antes de cada tarea pendiente ya están hechas (estado actual en el PLAN y en las descripciones de cada tarea).

### Teléfono (Android real)

- **Dispositivo:** Samsung Galaxy A14 (SM-A146M), Android 15, Chrome 157, 411×821 CSS.
- **Conexión:** depuración inalámbrica en `192.168.100.9`. El puerto de conexión cambia cada vez que se reactiva; la última vez fue `:34481`. El emparejamiento ya está hecho.
- **adb:** instalado con winget (`Google.PlatformTools`), en `%LOCALAPPDATA%\Microsoft\WinGet\Packages\Google.PlatformTools_Microsoft.Winget.Source_8wekyb3d8bbwe\platform-tools\adb.exe`.
- **Para reconectar:**
  ```bash
  adb connect 192.168.100.9:<puerto>
  adb reverse tcp:3100 tcp:3100
  adb forward tcp:9222 localabstract:chrome_devtools_remote
  ```
  Después hay que abrir `http://localhost:3100/berry/tasks` en Chrome del teléfono.
- **Scripts:** `scripts/phone-lib.cjs` y `scripts/phone-tests.cjs`. Solo tocan la pestaña de la app. Actualiza `DEV` en `phone-lib.cjs` si cambia el puerto.

### Siguiente paso

1. **Revisión del usuario de la Fase 1** (en el iPhone por `http://192.168.100.6:3100` y en el Android).
2. **Prueba en el Android real:** hecha y verde (ver "Puerta de la Fase 1"). Queda decidir si se oculta la barra inferior mientras el teclado está abierto.
3. **Decisiones pendientes del usuario:**
   - dónde arreglar el error de `tsc` de partida (`shell-launcher-dock.tsx:21`), que mantiene `build:check` en rojo;
   - D2 (tablet), D3 (arrastre táctil) y D4 (chat en light) para las fases 3 y 4.
4. **Fase 2** (causas raíz de layout): M2.1 a M2.7, con la misma forma de trabajo (Sonnet, una tarea por commit, puerta con `tsc` incluido).
5. **Cuando se termine de revisar todo lo de móvil:** subir la versión de Next (hoy `16.4.1`, reportada como vulnerable). Está anotado en `AGENTS.md`, en "Pending maintenance". Va en su propia rama y su propio PR.
