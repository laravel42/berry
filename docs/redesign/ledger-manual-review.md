# Ledger — checklist de revisión manual (fases 2 y 3B)

Cambios de las dos últimas fases que necesitan un vistazo en el navegador
(no hay test runner en `frontend/`, así que esto se verifica a ojo). Cada
punto dice qué abrir y qué confirmar. Commits: `ad7c7dc` (fase 2) y
`7185e76` (fase 3 opción B).

Arrancar: `pnpm storybook` (:6006) para los primitivos, y `pnpm dev:server`
+ la app para el shell.

## Fase 2 — primitivos

- [ ] **Botón, variante `dark`** — `components/ui/button.tsx`.
      Story `Button/Dark`. Relleno `bg-foreground` con texto `text-background`;
      debe invertirse de forma correcta en claro y en oscuro (cambia el tema de
      Storybook). Hover ligeramente más tenue. Altura 44px.
- [ ] **Tabs `pill` vs `underline`** — `components/ui/tabs.tsx`.
      Stories `Tabs/*` incluida `Underline`. El `pill` (por defecto) conserva el
      aspecto segmentado de antes; `underline` es subrayado. La pestaña activa
      debe coincidir entre lista y contenido (el contexto evita el desajuste).
- [ ] **Autopilot detail migrado a `underline`** —
      `components/common/autopilots/autopilot-detail.tsx`. En la app: detalle de
      un autopilot. Las tabs deben verse como subrayado, sin los hacks de
      `className` que tenían antes. Confirmar que no quedó espaciado raro.
- [ ] **Switch — área táctil 44px** — `components/ui/switch.tsx`.
      El control dibuja pequeño pero el objetivo invisible (`before`) es 44px.
      Comprobar que se puede pulsar cómodamente alrededor del thumb y que el
      `before` no tapa controles vecinos (p. ej. en filas de Settings).
- [ ] **Dialog — superficie card** — `components/ui/dialog.tsx`.
      Cualquier modal: fondo `bg-card` y esquinas `rounded-card` (20px), no el
      `rounded-lg` anterior. Revisar que el contenido no se salga del radio.

## Fase 3B — shell / rail

- [ ] **Contadores del rail como figura, no pill** — `shell-badge.tsx`.
      Story `ShellBadge/*`. En la app, barra lateral: Inbox, Reviews y Chat.
      El número ahora es mono-700 tabular (`data-figure`), sin la pastilla
      berry rellena. Los números deben alinearse verticalmente entre filas.
- [ ] **`.hot` = trabajo que te espera** — `shell-personal.tsx`.
      Inbox (no leídos) y Reviews (esperando) pintan el número en
      `--shell-accent` (berry, solo color, sin relleno). Chat se queda en el
      gris neutro (`--shell-text-dim`). Confirmar que **solo** esas dos filas
      llevan berry y que el acento no reaparece como pastilla en ningún sitio.
- [ ] **Legibilidad del contador tenue** — el gris `--shell-text-dim`
      (`#76747b`) sobre el rail oscuro. Comprobar que el número neutro (Chat)
      se lee sin esfuerzo; si queda demasiado apagado, subir el token.
- [ ] **Piso de 12px** — ningún contador debe verse por debajo de 12px
      (antes eran 10px). Verificar con el zoom/inspector si hay duda.
- [ ] **Cero oculto** — una fila con 0 no debe mostrar número.

## Deviaciones aceptadas (NO son bugs, no "arreglar")

- Rail a **218px** (no 240px del plan).
- El drawer cambia a overlay en **`lg` = 1024px** (no 900px).
- El disparador del drawer es el **botón flotante abajo-izquierda** (no en la
  barra de título). El hallazgo B6 del plan lo llama bug; el shell enviado lo
  mantiene a propósito.

## Pendiente / bloqueado (fuera de 3B)

- Breadcrumb `data-depth="mid"` → título del registro en Inter: necesita la
  cascada `data-depth`, que no existe (decisión abierta §5f). Mismo bloqueo
  dejó `data-depth="front"` fuera de `dialog`/`sheet` en la fase 2.
