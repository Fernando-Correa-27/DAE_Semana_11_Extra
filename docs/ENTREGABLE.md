# Entregable — Laboratorio extra S11: «Los hooks del agente»

**Curso:** Desarrollo de Aplicaciones Empresariales (DAE) · 4-C24-A
**Trabajo:** individual · Lester
**Repositorio de trabajo:** `https://github.com/Fernando-Correa-27/DAE_Semana_11_Extra`
**Rama:** `lab-11-extra-hooks-del-agente` · **Tag del estado original de la IA:** `ai-original`

---

## 0. Resumen

- Se completaron los tres hooks propios: `useDebounce`, `usePlans` y `useAgentRun`.
- Se revisaron los tres hooks «escritos por una IA» de `src/ai/`, se clasificaron sus **6 fallos** con evidencia y se arreglaron con cambios mínimos, un fallo por commit.
- Estado final: `npm test` → **57/57 en verde**; `npm run test:ai` → **57/57 en verde**; `npm run build` → correcto.
- No se modificaron `src/test/`, `package.json`, `src/lib/`, `src/data/`, `vite.config.js`, `.env.*` ni `AGENTS.md`.

### Nota de entorno (transparencia)

En este equipo las pruebas se ejecutaron con `NODE_OPTIONS=--no-experimental-webstorage`. Motivo: Node 26.13.1 define un global `localStorage` vacío y Vitest 3.2.7 no copia el de jsdom (la comprobación `if (k in global)` de `node_modules/vitest/dist/chunks/index.CmSc2RE5.js:250` descarta la clave). Sin ese ajuste, `src/test/setup.js:10` falla con `TypeError: Cannot read properties of undefined (reading 'clear')` y las 57 pruebas aparecen en rojo. Con el ajuste, la línea base coincide exactamente con el README: `40 failed | 17 passed (57)` en `npm test` y `20 failed | 37 passed (57)` en `npm run test:ai`. No se tocó ningún archivo del repositorio para conseguirlo.

---

## 1. Los seis hooks

Las cuatro preguntas de la revisión del diff, copiadas textualmente de `AGENTS.md`, son:

1. ¿Los hooks se llaman siempre en el mismo orden y en el nivel superior (sin `if`, bucles ni `return` antes)?
2. ¿Todo `useEffect` que abre algo (petición, temporizador) lo **limpia** al repetirse y al desmontar?
3. ¿Se resuelven los **tres estados** (cargando, con datos, con error) y se ven en pantalla?
4. ¿El dato vive en el **ancestro más bajo** que lo necesita, o el agente lo subió «por si acaso»?

### 1.1 `useDebounce` (propio) — `src/hooks/useDebounce.js`

**Qué hace.** Recibe `value` y `delay` y devuelve el último valor que ha permanecido `delay` ms sin cambiar. En el primer dibujado devuelve `value` tal cual; cada cambio reinicia la cuenta y cancela el temporizador anterior. Se usa en `Inbox` para que la lista espere 300 ms mientras la persona escribe, sin dejar de mostrar el texto al instante.

**Código clave.**

```js
import { useEffect, useState } from "react";

export default function useDebounce(value, delay) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
```

**Las cuatro preguntas.**

1. Sí: un `useState` y un `useEffect`, ambos en el nivel superior y sin condicionales.
2. Sí: el efecto devuelve `clearTimeout(timer)`, que React ejecuta al repetirse (cambio de `value`/`delay`) y al desmontar; las pruebas comprueban `vi.getTimerCount() === 0`.
3. No aplica: el hook no hace peticiones ni tiene estados de carga/error; solo entrega el valor «tranquilo». Los tres estados de la petición pertenecen a `usePlans`.
4. El estado vive dentro del hook, allí donde se usa; `Inbox` ya era dueño de `query` antes del cambio y no se movió ningún dato.

**Conteo de pruebas.**

| Medición | Antes | Después |
|---|---|---|
| `npm test -- useDebounce` | `5 failed \| 5 passed (10)` | `10 passed (10)` |
| `npm test` completo | `40 failed \| 17 passed (57)` | `34 failed \| 23 passed (57)` |

---

### 1.2 `usePlans` (propio) — `src/hooks/usePlans.js`

**Qué hace.** Recibe `fetchPlans` y devuelve `{ status, plans, error, reload }`. Pide los planes al montar y cada vez que cambia `fetchPlans` o se llama a `reload()`. Resuelve los tres estados de una petición y descarta cualquier respuesta que llegue después de que el efecto se haya repetido o el componente se haya desmontado.

**Código clave.**

```js
const reload = useCallback(() => {
  setStatus("loading");
  setPlans([]);
  setError(null);
  setRequestId((id) => id + 1);
}, []);

useEffect(() => {
  let cancelled = false;

  fetchPlans().then(
    (received) => {
      if (cancelled) return;
      setPlans(received);
      setStatus("ready");
    },
    (failure) => {
      if (cancelled) return;
      setError(failure);
      setStatus("error");
    }
  );

  return () => {
    cancelled = true;
  };
}, [fetchPlans, requestId]);
```

**Las cuatro preguntas.**

1. Sí: `useState`, `useCallback` y `useEffect` en el nivel superior; los `if` están dentro de los callbacks.
2. Sí: la limpieza pone `cancelled = true`; al repetirse el efecto o al desmontar, las respuestas pendientes no tocan el estado.
3. Sí: `loading` (esqueleto), `ready` (bandeja) y `error` (aviso con «Reintentar») se dibujan en `App.jsx:49-51`.
4. El estado de la petición vive en el hook que ya invocaba `App`; `Inbox` recibe los planes por props y `Header` solo el contador derivado.

**Conteo de pruebas.**

| Medición | Antes | Después |
|---|---|---|
| `npm test -- usePlans` | `11 failed \| 1 passed (12)` | `12 passed (12)` |
| `npm test` completo | `34 failed \| 23 passed (57)` | `18 failed \| 39 passed (57)` |

---

### 1.3 `useAgentRun` (propio) — `src/hooks/useAgentRun.js`

**Qué hace.** Máquina de estados de la ejecución de un plan: `idle → running → awaiting_approval → done`, con `error` como estado de fallo. Un plan de riesgo R2 **nunca** pasa de `running` a `done` sin `approve()`; un R1 va directo a `done`. `reject()` cancela y vuelve a `idle`. Al desmontar se aborta la ejecución en curso con un `AbortController`.

**Código clave.**

```js
runAgent(plan, { signal: controller.signal }).then(
  (result) => {
    if (controller.signal.aborted) return;
    controllerRef.current = null;
    apply({
      status: plan.risk === "R2" ? "awaiting_approval" : "done",
      plan,
      result,
      error: null,
    });
  },
  (error) => {
    if (controller.signal.aborted) return;
    controllerRef.current = null;
    apply({ status: "error", plan, result: null, error });
  }
);

// ...

const approve = useCallback(() => {
  if (stateRef.current.status !== "awaiting_approval") return;
  apply({ ...stateRef.current, status: "done" });
}, [apply]);

useEffect(() => {
  return () => {
    controllerRef.current?.abort();
  };
}, []);
```

**Las cuatro preguntas.**

1. Sí: todos los hooks están en el nivel superior; los `if` de transición están dentro de `start`, `approve` y `reject`.
2. Sí: el `useEffect` de montaje aborta el controlador al desmontar y cada respuesta comprueba `signal.aborted`.
3. Sí, adaptados a una máquina de ejecución: `RunPanel` dibuja `idle`, `running`, `awaiting_approval`, `done` y `error`, incluido el mensaje de fallo.
4. El estado vive en `RunPanel.jsx:8`, el componente que lo dibuja y el más bajo que lo necesita.

**Conteo de pruebas.**

| Medición | Antes | Después |
|---|---|---|
| `npm test -- useAgentRun` | `14 failed \| 4 passed (18)` | `18 passed (18)` |
| `npm test` completo | `18 failed \| 39 passed (57)` | **`57 passed (57)`** |
| `npm run build` | correcto en la línea base | `✓ built in 644ms` |

---

### 1.4 `useDebounce` (de la IA) — `src/ai/useDebounce.js`

**Qué hacía.** Misma idea que el propio, pero el efecto que abría el temporizador no devolvía limpieza: cada cambio dejaba vivo el temporizador anterior. El segundo efecto solo cancelaba el último temporizador al desmontar, así que los valores intermedios llegaban a devolverse y quedaban temporizadores pendientes.

**Arreglo (una línea).**

```diff
   useEffect(() => {
     timer.current = setTimeout(() => {
       setDebounced(value);
     }, delay);
+    return () => clearTimeout(timer.current);
   }, [value, delay]);
```

**Las cuatro preguntas.**

1. Sí: el arreglo no añade hooks ni cambia su orden; los hooks siguen en el nivel superior.
2. Sí: el efecto del temporizador ahora se limpia en cada repetición y al desmontar; el segundo efecto sigue existiendo, pero ya no es el único que cancela.
3. No aplica: el hook no hace peticiones; solo devuelve el valor «tranquilo».
4. Sin cambios: el estado sigue dentro del hook.

**Conteo de pruebas.**

| Medición | Antes | Después |
|---|---|---|
| `npm run test:ai -- useDebounce` | `5 failed \| 5 passed (10)` | `10 passed (10)` |
| `npm run test:ai` completo | `20 failed \| 37 passed (57)` | `15 failed \| 42 passed (57)` |

---

### 1.5 `usePlans` (de la IA) — `src/ai/usePlans.js`

**Qué hacía.** Pedía los planes y resolvía `loading`/`ready`, pero tenía dos fallos: el `.catch` solo escribía en consola (nunca pasaba a `error`) y no había cancelación lógica, así que una respuesta vieja podía pisar a la nueva.

**Arreglos.**

```diff
       .catch((err) => {
-        console.error("Error loading plans", err);
+        setError(err);
+        setStatus("error");
       });
```

```diff
   useEffect(() => {
+    let cancelled = false;
     setPlans([]);
     ...
       .then((data) => {
+        if (cancelled) return;
         setPlans(data);
         setStatus("ready");
       })
       .catch((err) => {
+        if (cancelled) return;
         setError(err);
         setStatus("error");
       });
+    return () => {
+      cancelled = true;
+    };
   }, [fetchPlans, attempt]);
```

**Las cuatro preguntas (estado final).**

1. Sí: no se añadieron hooks ni se alteró su orden; los `if` están dentro de los callbacks.
2. Sí: la limpieza pone `cancelled = true` y las respuestas pendientes ya no actualizan estado.
3. Sí: `loading`, `ready` y `error` se resuelven y `App` los dibuja con esqueleto, bandeja y aviso de error.
4. Sin cambios: el estado sigue en el hook que invoca `App`.

**Conteo de pruebas.**

| Fallo | Medición | Antes | Después |
|---|---|---|---|
| Estado de error | `npm run test:ai -- usePlans` | `5 failed \| 7 passed (12)` | `4 failed \| 8 passed (12)` |
| Respuesta vieja | `npm run test:ai -- usePlans` | `4 failed \| 8 passed (12)` | `12 passed (12)` |
| Ambos | `npm run test:ai` completo | `15 failed \| 42 passed (57)` | `9 failed \| 48 passed (57)` |

---

### 1.6 `useAgentRun` (de la IA) — `src/ai/useAgentRun.js`

**Qué hacía.** Implementaba la máquina de estados, pero con tres fallos: un R2 terminaba en `done` sin aprobación, el hook devolvía antes de `useRef` cuando faltaba `runAgent` (hook condicional) y no abortaba la ejecución al desmontar.

**Arreglos.**

```diff
           if (current.signal.aborted) return;
-          update({ status: "done", plan, result, error: null });
+          update({
+            status: plan.risk === "R2" ? "awaiting_approval" : "done",
+            plan,
+            result,
+            error: null,
+          });
```

```diff
-  if (!runAgent) {
-    return { ...IDLE, start: () => {}, approve: () => {}, reject: () => {} };
-  }
-
   const latest = useRef(IDLE);
   ...
     (plan) => {
+      if (!runAgent) return;
       const { status } = latest.current;
```

```diff
+  useEffect(() => {
+    return () => {
+      controller.current?.abort();
+    };
+  }, []);
+
   return { ...run, start, approve, reject };
```

**Las cuatro preguntas (estado final).**

1. Sí: todos los hooks se ejecutan siempre, en el mismo orden; el caso «sin `runAgent`» solo bloquea `start`.
2. Sí: el `useEffect` de montaje aborta el controlador al desmontar y las respuestas tardías se ignoran.
3. Sí: `RunPanel` dibuja los cinco estados y el error con su mensaje.
4. Sin cambios: el estado vive en el hook que invoca `RunPanel`.

**Conteo de pruebas.**

| Fallo | Medición | Antes | Después |
|---|---|---|---|
| R2 sin aprobación | `npm run test:ai -- useAgentRun` | `7 failed \| 11 passed (18)` | `2 failed \| 16 passed (18)` |
| Hook condicional | `npm run test:ai -- useAgentRun` | `2 failed \| 16 passed (18)` | `1 failed \| 17 passed (18)` |
| Sin abortar al desmontar | `npm run test:ai -- useAgentRun` | `1 failed \| 17 passed (18)` | `18 passed (18)` |
| Los tres | `npm run test:ai` completo | `9 failed \| 48 passed (57)` | **`57 passed (57)`** |

---

## 2. Tabla de los 6 fallos de la Parte 4

| # | Hook | Fallo | Clasificación | Evidencia (prueba o línea) | Arreglo | Conteos antes → después |
|---|---|---|---|---|---|---|
| 1 | `src/ai/useDebounce.js` | El efecto del temporizador no cancela el anterior al repetirse | Efecto sin limpieza | `useDebounce · cada cambio cancela el temporizador anterior` (4 pruebas) y `limpieza al desmontar` (1) | `return () => clearTimeout(timer.current)` dentro del efecto de `[value, delay]` | archivo `5 failed \| 5 passed (10)` → `10 passed (10)`; global IA `20 failed` → `15 failed` |
| 2 | `src/ai/usePlans.js` | El rechazo solo hace `console.error`; `status` se queda en `loading` | Estado de error no resuelto | `usePlans · los tres estados > si la petición falla…`, `reload > después de un error…` y `App > si la red falla…`; línea `src/ai/usePlans.js:18-20` | `setError(err)` + `setStatus("error")` en el `.catch` | archivo `5 failed \| 7 passed (12)` → `4 failed \| 8 passed (12)`; global `15 failed` → `13 failed` |
| 3 | `src/ai/usePlans.js` | La respuesta vieja pisa a la nueva (reload, cambio de `fetchPlans`, StrictMode) | Respuesta vieja que pisa a la nueva | `usePlans · ignora la respuesta vieja` (4 pruebas) | Bandera `cancelled`, comprobación en `.then`/`.catch` y limpieza que la activa | archivo `4 failed \| 8 passed (12)` → `12 passed (12)`; global `13 failed` → `9 failed` |
| 4 | `src/ai/useAgentRun.js` | Un R2 termina en `done` sin `approve()` | Aprobación que se salta un control | 4 pruebas de `un plan R2 no se aplica sin aprobación`, `esperando aprobación tampoco…` y 2 de `Inbox`; línea `src/ai/useAgentRun.js:32` | `status: plan.risk === "R2" ? "awaiting_approval" : "done"` | archivo `7 failed \| 11 passed (18)` → `2 failed \| 16 passed (18)`; global `9 failed` → `2 failed` |
| 5 | `src/ai/useAgentRun.js` | `return` antes de `useRef` cuando falta `runAgent` | Regla de los hooks (llamada condicional) | `useAgentRun · las reglas de los hooks > si runAgent aparece…`; líneas `8-10` | Quitar el `return` anticipado y comprobar `if (!runAgent) return;` dentro de `start` | archivo `2 failed \| 16 passed (18)` → `1 failed \| 17 passed (18)`; global `2 failed` → `1 failed` |
| 6 | `src/ai/useAgentRun.js` | No aborta la ejecución al desmontar | Efecto sin limpieza | `useAgentRun · limpieza al desmontar > al desmontar con una ejecución en curso aborta su señal` | `useEffect(() => () => controller.current?.abort(), [])` | archivo `1 failed \| 17 passed (18)` → `18 passed (18)`; global `1 failed` → `57 passed (57)` |

Los fallos 1 a 6 se arreglaron con cambios mínimos sobre el código original (no se reescribió ningún hook) y un commit `fix(ai): ...` por fallo, después del commit `chore(ai): save original AI-written hooks before fixing` y del tag `ai-original`.

---

## 3. Árbol de componentes y el dato que vive en cada nivel

Obtenido leyendo el código real (`src/App.jsx`, `src/components/*.jsx`, `src/hooks/*.js`).

```
main.jsx
└─ App                                  (datos de la aplicación)
   ├─ Header                             (solo recibe pendingCount)
   ├─ toolbar                            (checkbox de fallo de red + botón Recargar)
   ├─ PlansSkeleton                       (sin estado; se muestra con status "loading")
   ├─ ErrorBanner                         (sin estado; recibe error y onRetry)
   └─ Inbox                              (estado: query)
      ├─ buscador                        (input controlado por query)
      ├─ lista de pendientes
      │  └─ PlanCard                     (sin estado; recibe plan y onDecide)
      │     └─ HashConfirm               (estado: typed)
      └─ RunPanel                        (estado de ejecución vía useAgentRun)
```

| Nivel | Dato que vive ahí | Cómo se obtiene |
|---|---|---|
| `App` | `status`, `plans`, `error` de la petición; `decisions`; `failing` | `usePlans(fetchPlans)` y `useState`; `decisions` se lee de `localStorage` al montar y se guarda en un `useEffect` |
| `App` (derivado) | `pendingCount` | Se calcula en cada dibujado: planes sin decisión cuando `status === "ready"`; nunca se guarda |
| `Inbox` | `query` (lo que se escribe) | `useState("")`; el valor «tranquilo» sale de `useDebounce(query, 300)` |
| `Inbox` (derivado) | `pending`, `decided`, `approved`, `visible` | Filtros sobre `plans` y `decisions`, no son estado |
| `HashConfirm` | `typed` (el hash que teclea la persona) | `useState("")`; el botón se habilita solo si `typed === hash` |
| `RunPanel` | `status`, `plan`, `result`, `error` de la ejecución | `useAgentRun(runAgent)` |
| `Header`, `PlanCard`, `Button`, `ErrorBanner`, `PlansSkeleton` | Ningún dato propio | Todo llega por props |

Nota: `network.failing` es un objeto de módulo en `src/lib/api.js`; el checkbox de `App` lo escribe y además refleja el valor en el estado `failing` para volver a dibujar.

---

## 4. Por qué el contador de pendientes vive en `App` y no en la cabecera

La cabecera (`Header`) y la bandeja (`Inbox`) son **ramas hermanas**: `App` dibuja una y luego la otra, y ninguna contiene a la otra. El dato que hay que mostrar (cuántos planes siguen pendientes) cambia cuando la persona decide en la bandeja y se muestra en la cabecera. Si el contador viviera en `Inbox`, la cabecera no podría verlo; si viviera en `Header`, la bandeja no podría actualizarlo. El ancestro común más bajo que contiene a las dos es `App`, así que allí viven `plans` y `decisions`, y de ellos se **deriva** el número en cada dibujado (`App.jsx:33`). La cabecera recibe solo el número (`<Header pendingCount={pendingCount} />`, `App.jsx:37`), no la lista: no la necesita y así no se re-dibuja por cambios que no le afectan.

Esto se comprueba en `App.test.jsx:76-87`: al aprobar un plan en la bandeja, el contador de la cabecera baja de 4 a 3 y `fetchPlans` no se vuelve a llamar. Y `App.test.jsx:23-27` dibuja `Header` sola, con un número, sin la lista de planes.

---

## 5. Por qué esta interfaz no es la frontera de seguridad

Todo lo que decide la interfaz ocurre **en el navegador** y cualquiera puede alterarlo. Hechos verificados en este repositorio:

1. **La aprobación es un control del cliente.** `RunPanel` llama a `run.approve()` desde un botón (`RunPanel.jsx:48`) y el estado de la ejecución vive en memoria (`useAgentRun`). No hay ninguna llamada al servidor que registre quién aprobó.
2. **La confirmación por hash es una comparación en el cliente.** `HashConfirm` habilita el botón cuando `typed === hash` (`HashConfirm.jsx:20`); el hash se muestra en la propia tarjeta (`PlanCard.jsx:31`) y se compara como texto en el navegador. No se verifica contra el plan guardado en el servidor.
3. **Las decisiones se guardan en `localStorage`.** `App` las lee al montar (`App.jsx:16`) y las escribe en `storage.js` bajo la clave `dae-s11-decisions` (`storage.js:4,9,18`). Cualquiera puede abrir las herramientas de desarrollo y marcar planes como aprobados sin pulsar nada; la prueba `App.test.jsx:89-99` demuestra que las decisiones sobreviven a una recarga, que es cómodo para la persona pero no prueba identidad ni permiso.
4. **La red es simulada.** `src/lib/api.js` no habla con ningún servidor: espera 900 ms con `setTimeout`, devuelve los planes de `src/data/plans.js` y `runAgent` devuelve un resumen construido en el propio archivo (`api.js:27-41`). No hay autenticación, ni permisos, ni comprobación de que el `plan_hash` corresponda al plan guardado, ni registro de la aprobación.
5. **El cliente es modificable por definición.** Con las herramientas de desarrollo se puede cambiar el estado de React, editar `localStorage`, invocar funciones directamente o sustituir el bundle. Una interfaz solo puede **ayudar a decidir con información y evitar errores**; no puede impedir que un cliente malicioso haga otra cosa.

La frontera real debe estar en el **servidor**: verificar la identidad y los permisos de quien aprueba, comprobar que el `plan_hash` corresponde al plan realmente guardado y que existe una aprobación válida y autorizada antes de aplicar un cambio destructivo. La conexión real con la API del curso llega en la semana 12; hasta entonces, todo lo de este repositorio es una simulación local.

El propio `Header` lo advierte en pantalla: «Todo es local: la red es simulada… El límite de verdad lo impone el servidor (semana 8); aquí solo ayudamos a la persona a decidir bien» (`Header.jsx:16-19`).

---

## 6. Uso de IA y diffs rechazados

Tabla completa en `docs/ai-use-log.md` (se reproduce aquí):

| # | Qué se pidió | Qué respondí | Aceptado / rechazado | Por qué | Evidencia |
|---|---|---|---|---|---|
| 1 | Completar el laboratorio extra de la semana 11: hooks propios, revisión de `src/ai/`, entregable y push. | Detecté dos bloqueos antes de escribir código: `AGENTS.md:17` prohíbe `git push` y `gh` no está instalado. Pedí autorización explícita para las excepciones y para usar Git con las credenciales guardadas. | Aceptado | El contrato dice que `AGENTS.md` manda sobre el prompt; la excepción solo podía autorizarla Lester. | `gh --version` → `CommandNotFoundException`. `git config --global --get credential.helper` → `store`. |
| 2 | Resolver el desajuste de la línea base (el README espera 40 fallos y salían 57). | Diagnostiqué una incompatibilidad Node 26 / Vitest 3.2.7 y propuse neutralizarla con `NODE_OPTIONS=--no-experimental-webstorage`. | Aceptado | Sin el ajuste ninguna prueba llega a ejecutarse; con él los conteos coinciden con el README. | `npm test` → `57 failed (57)`; con el flag → `40 failed \| 17 passed (57)`. `npm run test:ai` con el flag → `20 failed \| 37 passed (57)`. |
| 3 | Turno 1: implementar `src/hooks/useDebounce.js`. | Estado inicializado en `value` + `useEffect` con `setTimeout`/`clearTimeout`. | Aceptado | Cumple retardo, cancelación, cambio de `delay` y limpieza al desmontar. | `npm test -- useDebounce`: `5 failed \| 5 passed (10)` → `10 passed (10)`. Suite: `40 failed` → `34 failed`. |
| 4 | Resolver el push: la cuenta autenticada no tenía permiso en el repo de Hellscythe25. | Reporté el 403 y pedí decisión. Lester autorizó crear `DAE_Semana_11_Extra` y subir allí los cambios. | Aceptado | El repo original es de otra cuenta; se conserva como `upstream`. | `git push --dry-run` → `Permission ... denied to Fernando-Correa-27` (403). Repo creado y ramas subidas. |
| 5 | Turno 2: implementar `src/hooks/usePlans.js`. | Tres estados, `reload()` estable y bandera `cancelled`. | Aceptado | Resuelve los tres estados y las carreras sin tocar componentes. | `11 failed \| 1 passed (12)` → `12 passed (12)`; suite `34 failed` → `18 failed`. |
| 6 | Turno 3: implementar `src/hooks/useAgentRun.js`. | Máquina de estados con `AbortController`, `approve()` solo desde `awaiting_approval` y respuestas tardías ignoradas. | Aceptado | Un R2 no llega a `done` sin aprobación; suite completa en verde. | `14 failed \| 4 passed (18)` → `18 passed (18)`; suite `57 passed (57)`; build correcto. |
| 7 | Parte 4: guardar el estado original de `src/ai/`. | Copié los tres hooks a `docs/evidence/part4/original/` (hashes idénticos) y guardé las salidas. | Aceptado (paso prescrito) | El tag `ai-original` debe apuntar al estado sin arreglos. | `test:ai` → `20 failed \| 37 passed (57)`; `npm test` → `57 passed (57)`. Commit `f6c6d15`, tag `ai-original`. |
| 8 | Fallo 1: `src/ai/useDebounce.js` no cancela el temporizador anterior. | Añadí `return () => clearTimeout(timer.current)`. | Aceptado | Es la causa de los 5 fallos y el cambio es una línea. | `5 failed \| 5 passed (10)` → `10 passed (10)`; IA `20 failed` → `15 failed`. |
| 9 | Fallo 2: `src/ai/usePlans.js` se queda en `loading` al fallar. | Cambié el `console.error` por `setError` + `setStatus("error")`. | Aceptado | Sin esos estados la interfaz no muestra el error ni permite reintentar. | `5 failed \| 7 passed (12)` → `4 failed \| 8 passed (12)`; IA `15 failed` → `13 failed`. |
| 10 | Fallo 3: `src/ai/usePlans.js` deja que la respuesta vieja pise a la nueva. | Bandera `cancelled`, comprobación en `.then`/`.catch` y limpieza. | Aceptado | Las 4 pruebas de carrera pasan. | `4 failed \| 8 passed (12)` → `12 passed (12)`; IA `13 failed` → `9 failed`. |
| 11 | Fallo 4: `src/ai/useAgentRun.js` aplica un R2 sin aprobación. | Condicioné el estado final al riesgo del plan. | Aceptado | Un R2 ya no llega a `done` sin `approve()`. | `7 failed \| 11 passed (18)` → `2 failed \| 16 passed (18)`; IA `9 failed` → `2 failed`. |
| 12 | Fallo 5: `src/ai/useAgentRun.js` devuelve antes de `useRef` cuando falta `runAgent`. | Quité el `return` anticipado y moví la comprobación a `start`. | Aceptado | Los hooks se ejecutan siempre en el mismo orden. | `2 failed \| 16 passed (18)` → `1 failed \| 17 passed (18)`; IA `2 failed` → `1 failed`. |
| 13 | Fallo 6: `src/ai/useAgentRun.js` no aborta la ejecución al desmontar. | Añadí un `useEffect` cuya limpieza llama a `controller.current?.abort()`. | Aceptado | La señal se aborta al desmontar y la suite de la IA queda en verde. | `1 failed \| 17 passed (18)` → `18 passed (18)`; IA `1 failed` → `57 passed (57)`. |
| 14 | Parte 5: crear `docs/ENTREGABLE.md` en español con las seis secciones pedidas. | Redacté el documento completo con las cuatro preguntas por hook y evidencia verificada. | Aceptado | Incluye todo lo que pide la Parte 5. | `npm test` → `57 passed (57)`; `test:ai` → `57 passed (57)`; `build` → `✓ built in 663ms`. |
| 15 | Revisar un candidato de simplificación de `src/ai/usePlans.js` (quitar la bandera `cancelled`). | Presenté el diff sin commitear y su evidencia: 4 pruebas de carrera en rojo. | **Rechazado** | «Respuesta vieja vuelve a pisar». | `npm run test:ai -- usePlans` → `4 failed \| 8 passed (12)`; diff en `docs/evidence/rejections/01-usePlans-ai-cancelled.diff`; tras restaurar, `12 passed (12)` y `57 passed (57)`. |

### Diffs rechazados

- **01 — `src/ai/usePlans.js`** (`01-usePlans-ai-cancelled.diff`): propuesta de quitar la bandera `cancelled` y su limpieza, dando por hecho que React ignora las respuestas tardías. **Rechazado** por Lester: «Respuesta vieja vuelve a pisar». Evidencia: `npm run test:ai -- usePlans` → `Tests 4 failed | 8 passed (12)`, con las 4 pruebas de carrera en rojo. Corrección: se mantiene la versión aprobada con `cancelled`; tras `git restore`, `12 passed (12)` y `57 passed (57)` en la suite completa.

---

## Anexo: evidencias

- Línea base: `docs/evidence/baseline-npm-test.txt`, `baseline-npm-run-test-ai.txt`, `baseline-npm-run-build.txt` y las pruebas del ajuste de entorno en `probe-*.txt`.
- Turnos 1 a 3 (hooks propios): `turn01-*.txt`, `turn02-*.txt`, `turn03-*.txt`.
- Parte 4: `docs/evidence/part4/original/` (estado original de `src/ai/` y salida con 20 fallos) y `turn4-*.txt` a `turn9-*.txt` (antes/después de cada fallo, suite completa y build final).
- Rechazo 01: `docs/evidence/rejections/01-usePlans-ai-cancelled.diff` (diff propuesto), `01-candidate-test-ai.txt` y `.json` (4 pruebas en rojo) y `01-after-restore-test-ai.txt` (vuelta al verde).
- Registro de uso de IA: `docs/ai-use-log.md`.
