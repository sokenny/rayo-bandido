# Rayo Bandido — Especificación del MVP del día 1

## Objetivo

Obtener, después de una primera sesión agéntica de aproximadamente una hora o más, una versión jugable en navegador que permita comprobar la fantasía central de **Rayo Bandido**.

El resultado no tiene que parecer un juego terminado. Tiene que permitir responder una pregunta:

> ¿Es divertido conducir el GT86, usar nitro, driftear para acumular energía y descargar un rayo contra autos eléctricos?

## Definición de MVP jugable

Al finalizar el día 1 debe existir una URL o build local que incluya:

- Una escena 3D nocturna, oscura y pequeña con una primera lectura visual JDM × cyberpunk.
- Un único auto controlable: Toyota GT86 con modelo provisional o definitivo.
- Cámara arcade en tercera persona.
- Aceleración, frenado, dirección y marcha atrás.
- Física de manejo arcade con capacidad clara de iniciar y sostener un drift.
- Barra de nitro con recarga gradual y activación manual.
- Humo o marcas simples de neumáticos durante el derrape.
- Barra de energía que aumenta mientras el drift es válido.
- Al menos tres autos eléctricos enemigos o blancos.
- Una descarga de rayo activable al alcanzar suficiente energía.
- Respuesta visible al impacto: apagado, explosión estilizada, salto o desaparición del objetivo.
- Dinero otorgado por cada auto eléctrico alcanzado, visible mediante un contador.
- Reinicio inmediato de la partida.
- Contador simple de objetivos destruidos o desactivados.

## Fuera de alcance para el día 1

- Mundo abierto.
- Multijugador funcional, aunque sigue siendo un requisito futuro del proyecto.
- Tráfico complejo.
- Historia, diálogos o cinemáticas.
- Personalización funcional del vehículo.
- Taller o economía.
- Varios autos jugables.
- Daño realista.
- IA policial o persecuciones elaboradas.
- Física de simulación.
- Compatibilidad móvil completa.
- Arte final para toda la ciudad.

## Dirección técnica inicial

- Cliente web con TypeScript, Three.js y una herramienta de desarrollo web rápida.
- Física mediante una librería compatible con navegador, encapsulada para poder ajustar o reemplazar el modelo de conducción.
- Assets en formato glTF/GLB y texturas comprimidas cuando sea posible.
- Arquitectura deliberadamente pequeña: escena, vehículo, controles, cámara, drift, energía, objetivos y efectos.
- Desarrollo desktop-first con teclado; gamepad puede añadirse después.
- El MVP será single-player, pero la entrada, la simulación del auto, el estado de gameplay y el render deben mantenerse razonablemente separados para facilitar una futura capa multijugador.

La primera sesión debe priorizar una experiencia vertical completa por encima de una arquitectura extensa.

## Presupuesto de rendimiento

La fluidez tiene prioridad sobre la calidad gráfica. El prototipo debe establecer mediciones básicas desde el comienzo y evitar efectos costosos sin una mejora visual clara.

- Objetivo inicial: 60 FPS estables en una computadora de gama media con navegador moderno; 30 FPS estables será el piso aceptable para hardware más modesto.
- Dirección visual retro, low-poly o estilizada permitida y recomendada cuando reduzca el costo de render.
- Cantidad limitada de luces dinámicas; preferir iluminación horneada, emisivos y trucos visuales económicos.
- Instancing para objetos repetidos y pooling para partículas, autos eléctricos y proyectiles/efectos.
- Resolución de sombras, densidad de partículas, reflejos y postprocesado configurables.
- Assets GLB comprimidos y texturas con tamaños razonables.
- Medición visible o modo debug con FPS, draw calls, triángulos y memoria aproximada.

No se debe sacrificar la lectura del drift, el rayo o la cámara para obtener gráficos más detallados.

## Preparación para multijugador futuro

El MVP no incluye red, lobby ni sincronización entre jugadores. Sin embargo:

- Las acciones del jugador deben poder representarse como inputs o comandos claros.
- El estado esencial del vehículo no debe depender exclusivamente de efectos visuales o del DOM.
- Las reglas de drift, nitro, rayo, dinero y objetivos deben vivir fuera de la UI.
- No se debe implementar todavía un servidor ni una abstracción de networking genérica.

La compatibilidad multijugador es una restricción de diseño; no un entregable del día 1.

## Workflow agéntico

La implementación se realizará mediante un orquestador de código —por ejemplo, Fable Five Ultra Code o la herramienta disponible equivalente— coordinando subagentes de modelos potentes como Opus 5.

### Responsabilidad del orquestador

- Leer esta especificación y el documento de concepto antes de modificar código.
- Dividir el trabajo en tareas pequeñas con criterios de aceptación comprobables.
- Mantener un único backlog y un registro de decisiones.
- Asignar tareas independientes en paralelo cuando no editen los mismos archivos.
- Integrar, ejecutar y probar los aportes de los subagentes.
- Evitar reescrituras generales sin una falla concreta que las justifique.
- Detener expansiones de alcance que no ayuden a completar el MVP.

### Subagentes sugeridos

1. **Base técnica:** proyecto, render, iluminación, carga de assets y loop principal.
2. **Vehículo:** controles y física arcade de drift.
3. **Gameplay:** detección del drift, combo, energía, blancos y descarga del rayo.
4. **Presentación:** cámara, humo, chispas, rayo, UI y atmósfera nocturna.
5. **Integración y QA:** ejecución del build, errores, rendimiento y criterios de aceptación.

Estos roles no obligan a ejecutar cinco agentes permanentemente. El orquestador debe aumentar o reducir el paralelismo según costo, conflictos de edición y tokens disponibles.

## Control del consumo de tokens

- Usar el modelo más costoso para arquitectura, integración difícil, revisión y bloqueos.
- Delegar tareas mecánicas o bien delimitadas a modelos más económicos cuando sea posible.
- Dar a cada agente solo los archivos y criterios relevantes para su tarea.
- Establecer un máximo de intentos antes de escalar un bloqueo al orquestador.
- Preferir pruebas y evidencia del runtime frente a largas discusiones especulativas.
- Registrar resúmenes compactos de lo realizado para que otro agente pueda continuar sin releer toda la conversación.
- No abrir trabajo nuevo mientras haya errores de build o integración sin resolver.

## Tracking del progreso

El repositorio debería contener:

- `AGENTS.md`: reglas del proyecto, visión resumida y límites del MVP.
- `docs/DECISIONS.md`: decisiones técnicas o creativas importantes y sus motivos.
- `docs/PROGRESS.md`: estado actual, qué funciona, qué está roto y próximo paso.
- `docs/REFERENCES.md`: referencias visuales y de jugabilidad aprobadas por Juan.
- Un backlog pequeño con estados `todo`, `in_progress`, `blocked` y `done`.

Cada sesión debe terminar dejando:

1. Build ejecutable.
2. Pruebas o checklist actualizado.
3. Progreso y bloqueos documentados.
4. Próximas tres tareas priorizadas.

## Paquete de referencias controlado por Juan

Antes de dar autonomía prolongada a los agentes conviene formar un paquete pequeño y explícito de referencias. Su función no es pedir que copien una obra, sino reducir decisiones estéticas accidentales.

### Referencias mínimas

| Área | Decisión que debe fijar Juan | Cantidad sugerida |
| --- | --- | --- |
| Cámara | Altura, distancia, FOV y cuánto anticipa los giros | 2–3 videos o capturas |
| Manejo | Arcade, facilidad para iniciar drift y tolerancia del combo | 2 juegos + notas |
| GT86 | Año/fascia, color, bodykit, llantas, alerón y livery | 5–10 imágenes |
| Ciudad | Equilibrio 50/50 JDM × cyberpunk; arquitectura, clima, oscuridad, neón y paleta | 5–8 imágenes |
| Efectos | Humo, fuego, electricidad y destrucción | 3–5 referencias |
| UI | Velocímetro, combo, barra de energía y tipografía | 2–4 referencias |
| Audio | Motor, turbo/escape, neumáticos y música | 3–5 clips o temas |

Cada referencia debe tener una nota breve: **qué se toma** y **qué no se toma**. Una imagen sin anotación deja demasiada interpretación al agente.

## Decisiones creativas que no debe inventar el agente

- Apariencia definitiva del GT86 protagonista.
- Punto de vista y comportamiento principal de la cámara.
- Nivel de realismo de la conducción.
- Paleta central y tono visual.
- Forma exacta de la descarga del rayo.
- Tono de violencia/destrucción de los autos eléctricos.
- Logo y tipografía de Rayo Bandido.

Si falta alguna de estas decisiones durante el primer MVP, se debe utilizar una opción provisional claramente marcada y fácil de reemplazar.

## Orden de ejecución recomendado para la primera sesión

1. Crear proyecto y mostrar una pista simple.
2. Poner un vehículo provisional en movimiento.
3. Lograr una conducción arcade razonable y una cámara legible.
4. Añadir el nitro y su recarga gradual.
5. Detectar el drift y cargar la barra del rayo.
6. Añadir blancos eléctricos, la descarga y la recompensa monetaria.
7. Integrar GT86 y mejorar la atmósfera JDM × cyberpunk.
8. Probar el recorrido completo y corregir bloqueos.
9. Guardar captura o video del estado final y actualizar progreso.

## Criterio de éxito

El MVP del día 1 está terminado cuando una persona puede abrirlo sin instrucciones extensas, conducir durante uno o dos minutos, usar nitro, entender que el drift carga el rayo, destruir o desactivar por lo menos un auto eléctrico y ver que recibió dinero por hacerlo.

Todo lo demás pertenece a la iteración siguiente.
