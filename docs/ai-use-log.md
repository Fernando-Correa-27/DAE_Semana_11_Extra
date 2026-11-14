# Registro de uso de IA — Laboratorio extra S11 «Los hooks del agente»

Tabla de pedidos de Lester al agente. Las evidencias son comandos reales y salidas recortadas a lo relevante.
Nota de entorno: en este equipo (Node 26.13.1 + Vitest 3.2.7) hay que correr las pruebas con
`NODE_OPTIONS=--no-experimental-webstorage`; sin ese ajuste `window.localStorage` es `undefined` en
`src/test/setup.js:10` y fallan las 57 pruebas. Ver fila 2.

| # | Qué se pidió | Qué respondí | Aceptado / rechazado | Por qué | Evidencia |
|---|---|---|---|---|---|
| 1 | Completar el laboratorio extra de la semana 11: hooks propios (`useDebounce`, `usePlans`, `useAgentRun`), revisar los 3 hooks de `src/ai/`, entregable y push. | Detecté dos bloqueos antes de escribir código: `AGENTS.md:17` prohíbe `git push` y `gh` no está instalado. Pedí autorización explícita para las excepciones y para usar Git con las credenciales guardadas. | Aceptado | El contrato dice que `AGENTS.md` manda sobre el prompt; la excepción solo podía autorizarla Lester. | `gh --version` → `CommandNotFoundException`. `git config --global --get credential.helper` → `store`. |
| 2 | Resolver el desajuste de la línea base (el README espera 40 fallos y salían 57). | Diagnostiqué una incompatibilidad Node 26 / Vitest 3.2.7: Node define un global `localStorage` vacío y Vitest no copia el de jsdom (`node_modules/vitest/dist/chunks/index.CmSc2RE5.js:250`). Propuse neutralizarlo con `NODE_OPTIONS=--no-experimental-webstorage`. | Aceptado | Sin el ajuste ninguna prueba llega a ejecutarse; con él los conteos coinciden exactamente con el README. | `npm test` → `Tests 57 failed (57)`. Con el flag → `Tests 40 failed \| 17 passed (57)`. `npm run test:ai` con el flag → 20 failed / 37 passed. Evidencias en `docs/evidence/`. |
| 3 | Turno 1: implementar `src/hooks/useDebounce.js`. | Estado inicializado en `value` + `useEffect` con `setTimeout`/`clearTimeout` y dependencias `[value, delay]`. Presenté diff, las 4 preguntas respondidas y conteos. | Aceptado | Cumple las pruebas de retardo, cancelación, cambio de `delay` y limpieza al desmontar. | `npm test -- useDebounce`: antes `5 failed \| 5 passed (10)`, después `10 passed (10)`. Suite: `40 failed \| 17 passed (57)` → `34 failed \| 23 passed (57)`. |
| 4 | Resolver el push: la cuenta autenticada no tenía permiso en el repo de Hellscythe25. | Reporté el 403 y pedí decisión. Lester autorizó crear `DAE_Semana_11_Extra` con las credenciales registradas y subir allí los cambios. | Aceptado | El repo original es de otra cuenta; se conserva como `upstream` y el trabajo se publica en el repo nuevo. | `git push --dry-run` → `Permission ... denied to Fernando-Correa-27` (403). Repo creado `Fernando-Correa-27/DAE_Semana_11_Extra`; `main` y `lab-11-extra-hooks-del-agente` subidos. |
| 5 | Turno 2: implementar `src/hooks/usePlans.js`. | Tres estados (`loading`/`ready`/`error`), `reload()` con `useCallback` y contador de petición, y bandera `cancelled` en la limpieza para descartar respuestas viejas. | Aceptado | Resuelve los tres estados y las carreras de peticiones sin tocar componentes. | `npm test -- usePlans`: antes `11 failed \| 1 passed (12)`, después `12 passed (12)`. Suite: `34 failed \| 23 passed (57)` → `18 failed \| 39 passed (57)`. |
| 6 | Turno 3: implementar `src/hooks/useAgentRun.js`. | Máquina `idle`/`running`/`awaiting_approval`/`done`/`error` con un solo estado, `AbortController` por ejecución, `approve()` solo desde `awaiting_approval` y respuestas tardías ignoradas por `signal.aborted`. | Aceptado | Un R2 no llega a `done` sin aprobación y la suite completa queda en verde. | `npm test -- useAgentRun`: antes `14 failed \| 4 passed (18)`, después `18 passed (18)`. Suite: `57 passed (57)`, 5/5 archivos. `npm run build` → `✓ built in 644ms`. |

## Diffs rechazados

Ninguno hasta ahora.

<!-- Se añadirá una fila por turno y, si hay rechazo, el archivo del diff en docs/evidence/rejections/. -->
