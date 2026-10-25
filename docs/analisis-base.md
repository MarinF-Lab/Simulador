# Análisis del prototipo base

Fuente: `docs/referencias/simulador-base.html`, bloque `LABORATORIO` (líneas 392–1425).
Este documento lista qué se porta a KINETIC, a qué módulo va y qué cambia.

## 1. Constantes

| Prototipo | Valor | Uso | En KINETIC |
|---|---|---|---|
| `GRID` | 20 px | paso de la cuadrícula 2D | `GRID_MM = 10` (mm, mesa 3D) |
| `RINT` | 0,05 Ω | resistencia interna de la pila | `core/electrical` |
| `GC` | 1000 S | conductancia de cable e interruptor cerrado | `core/electrical` |
| `GL` | 0,1 S (10 Ω) | tramo encendido del LED | `core/electrical` |
| `gmin` | 1e-9 S | en cada nodo, evita matriz singular | `core/electrical` |
| `WW × WH` | 2400 × 1600 | tamaño del mundo 2D | tamaño de la mesa 3D |
| `RPM_N` | 120 | RPM del motor a voltaje nominal | se reemplaza por el modelo R, Ke, Kt (etapa 5) |

## 2. Modelo de datos

- **Componente** `{id, type, x, y, rot, ...props}`. Tipos: `bat` (v), `res` (r), `pot` (r), `sw` (closed), `bulb` (vn), `motor` (vn), `led` (vf, on), `buzz` (vn). Las cargas tienen `burned` y `burnV`.
- **Bornes**: dos por componente, a ±40 del centro según `rot` (`termPos`). El borne 1 es el **+** en pila, LED y motor.
- **Cable** `{id, shape: hv|vh|line, e:[punta, punta]}`. Cada punta tiene `{x, y, att}`, donde `att = {c, t}` la pega a un borne (`epos`).
- **Pieza mecánica** `{id, type: gear|pulley, size: s|m|l, x, y, att}`. `att` = id del motor sobre cuyo eje está montada (`mpos`).
- **Liga o correa** `{id, a, b, cross}` entre dos poleas.
- Radios (`mr`): engranaje = dientes × 2 (10, 20, 40 dientes); polea S/M/L = 16, 28, 44.

Va a `core/model` como tipos TypeScript. El modelo pasa a 3D (x, y, z y rotación por eje), pero conserva la idea de **conexión por posición**.

## 3. Lógica eléctrica → `core/electrical`

### `simulate`
1. Asigna un nodo a cada coordenada distinta de borne o punta de cable. Lo que comparte posición queda unido.
2. Arma la matriz G (MNA solo con conductancias) y el vector I:
   - pila: equivalente Norton, `1/RINT` en paralelo con una fuente de `v/RINT`
   - LED encendido: `GL` en serie con `vf`; apagado: abierto
   - resto: conductancia de `cond(c)`
   - cables: `GC`
3. Resuelve con `solve` (Gauss con pivoteo parcial).
4. Calcula `{v, i}` por pieza. `v` = V(borne 1) − V(borne 0).
5. Actualiza estados y repite (hasta 12 pasadas):
   - ampolleta, motor, zumbador: **quemado** si |v| > 1,25 × vn
   - LED: quemado si i > 0,04 A; se apaga si i < 0; se enciende si v > vf

### `cond` (cargas como resistencias fijas)
- resistencia y potenciómetro: 1/r
- interruptor: 1000 S cerrado, 0 abierto
- ampolleta 0,5/vn² (0,5 W nominal), motor 3/vn² (3 W), zumbador 0,25/vn²
- quemado: 0

### `diagnose` (avisos)
| Aviso | Nivel | Condición |
|---|---|---|
| Mesa vacía / Sin energía | info | no hay piezas / no hay pilas |
| Pilas en paralelo con distinto voltaje | error | mismos nodos, v distinto |
| Pilas en paralelo invertidas | error | + de una con − de otra en ambos lados |
| Cortocircuito | error | caída en RINT > 30 % de v |
| Componente quemado (ampolleta, motor, zumbador, LED) | error | `burned` |
| LED invertido | advertencia | v < −0,5 V |
| Pilas en serie invertidas | advertencia | nodo con solo dos pilas unidas por el mismo polo |
| Circuito abierto | advertencia | ninguna pila con \|i\| ≥ 1e-4 A; explica la causa (interruptor abierto o pieza quemada) |
| Componente(s) desconectado(s) | advertencia | borne con menos de 2 conexiones |
| Cable suelto | advertencia | punta con menos de 2 conexiones |
| Circuito funcionando / Circula corriente | ok | hay corriente y no hay errores |

Cada aviso marca su pieza (`flag[id]` = err o warn). Se ordenan: error, advertencia, info, ok.

## 4. Lógica mecánica → `core/mechanical`

### `mechanics`
1. Agrupa por **eje**: las piezas en la misma posición giran juntas. Un motor en esa posición es la fuente del eje.
2. Arma relaciones entre ejes:
   - engranajes que engranan (|d − (r1 + r2)| < 2): factor **−r1/r2**
   - engranajes superpuestos (d < r1 + r2 − 2): aviso
   - liga normal: **+r1/r2**; cruzada: **−r1/r2** (`bandGeom` valida la geometría)
3. Por cada grupo conectado, propaga relaciones desde un eje base (BFS). Si un eje recibe dos valores distintos (tolerancia 0,5 %), **está trabado**.
4. Escala por el motor. Si un segundo motor del grupo impone otra velocidad, también se traba.
5. Avisos: engranajes trabados (error), superpuestos, liga mal colocada, pieza suelta (advertencias), sin motor (info).

### `bandGeom`
Tangentes externas (liga normal) o internas (cruzada) entre dos círculos. Es inválida si las poleas están demasiado juntas. En 3D se usa para dibujar la correa.

### `mechSnap` y `gearPath`
- `mechSnap`: imán al eje de un motor o de otra pieza (16 px), y a la distancia exacta de engrane (18 px).
- `gearPath`: perfil de dientes. En 3D se cambia por una geometría extruida.

## 5. Interacción → `scene/` y `ui/`

| Función | Qué hace | Dónde va |
|---|---|---|
| `snap`, `clampComp`, `clampPt` | ajuste a la cuadrícula y límites del mundo | `core/model` + `scene` |
| `zoomAt`, `computeFit`, `clampPan` | zoom en un punto, encuadre y límites del desplazamiento | `scene/camera` (ortográfica) |
| `startPinch`, `updatePinch` | pellizco con dos dedos | `scene/gestures` |
| `edgeTick` | autodesplazamiento al arrastrar cerca del borde (30 px) | `scene/gestures` |
| `addFromPalette`, `findFree` | arrastrar desde la biblioteca; un toque coloca en un espacio libre | `ui/Library` + `scene` |
| `connectTerms`, `snapTarget` | crear cables de borne a borne; imán de 26 px / zoom | `scene/wires` |
| `epos`, `reattach`, `cablePath` | puntas pegadas a bornes; forma L o recta | `core/model` + `scene/wires` (tubos) |
| `rotateComp`, `flipComp` | girar 90° (⟳, doble toque en menos de 350 ms, tecla R) e invertir polaridad | `core/history` (comandos) |
| `voltCtl`, `drawInspector` | deslizador + casilla que acepta coma decimal; lecturas en vivo | `ui/Properties` |
| `diagnose` → `drawStatus` | lista de avisos con semáforo | `ui/Status` |
| `req` | un render por cuadro con `requestAnimationFrame` | el bucle de R3F lo reemplaza |

Atajos de teclado: Escape (cancelar), R (girar), Supr/Retroceso (eliminar).

## 6. Formato de lecturas
- Voltaje primero, en V, con coma decimal (`es-CL`, 2 decimales).
- Corriente en A con 3 decimales. **Nunca en mA.**
- Ya portado en `src/core/model/units.ts`, con pruebas.

## 7. Casos de prueba (etapas 3 y 4)
1. 9 V + interruptor + 100 Ω + ampolleta de 6 V → unos **3,77 V** en la ampolleta.
2. 9 V + 470 Ω + LED de 2 V → unos **2,15 V** en el LED.
3. 9 V + 100 Ω + LED → LED **quemado**.
4. Engranaje de 10 dientes a 120 RPM → uno de 40 dientes a **−30 RPM**.
5. Tres engranajes iguales en triángulo → **trabados**.

## 8. Qué no se porta
- Pestañas Serie, Paralelo y Mixto (página educativa de baterías).
- Potenciómetro y zumbador con sonido: no están en la biblioteca de KINETIC. Se pueden sumar después.
- Dibujo SVG: lo reemplaza la escena Three.js.
