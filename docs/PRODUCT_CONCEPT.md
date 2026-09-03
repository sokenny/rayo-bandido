# Rayo Bandido

## Concepto base

**Rayo Bandido** es un juego de conducción y drift para navegador, pensado para desarrollarse con Three.js. Su identidad mezcla en partes iguales —**50% JDM y 50% cyberpunk**— el autotuning japonés, el drift callejero y una distopía tecnológica oscura. Toma como referencia la atmósfera nocturna de *Need for Speed Underground 2*, pero con un mundo, personajes y vehículos propios.

En un futuro distópico, todos los autos han sido reemplazados por vehículos eléctricos: silenciosos, uniformes, controlados y conectados a una misma red. En ese mundo aparece el **Rayo Bandido**, un auto de combustión rebelde cuyo cometido es obliterar los autos eléctricos de la ciudad mediante el drift.

## Fantasía central

El jugador conduce un auto clandestino, ruidoso y excesivo por una ciudad dominada por vehículos eléctricos. Al derrapar genera calor, fuego y una carga eléctrica creciente. Esa energía alimenta el **poder del rayo**, que puede descargarse sobre los autos eléctricos para inutilizarlos.

La idea esencial es:

> Driftear genera poder. Mantener y combinar derrapes carga el rayo. Descargar el rayo destruye o desactiva los autos eléctricos.

## Sistemas de poder

El auto posee dos recursos con funciones distintas:

### Rayo

- Se carga exclusivamente mediante el drift.
- Los derrapes largos o encadenados cargan más energía.
- Puede dispararse contra los autos eléctricos de la ciudad.
- Destruir o desactivar esos vehículos entrega dinero.
- El dinero se usa posteriormente para comprar modificaciones del GT86: rendimiento, estética o mejoras de los poderes.

### Nitro

- Se recarga gradualmente con el paso del tiempo o durante la conducción normal; la velocidad exacta se ajustará durante las pruebas.
- Se consume para obtener una aceleración fuerte y sostener el ritmo de la conducción.
- No reemplaza al rayo ni depende del drift: funciona como un recurso complementario y más frecuente.

La separación buscada es clara: **el nitro da velocidad; el drift carga el arma; el rayo genera dinero; el dinero mejora el auto**.

## Bucle jugable preliminar

1. Recorrer la ciudad y localizar grupos, convoyes o enjambres de autos eléctricos.
2. Usar el nitro, que se regenera gradualmente, para acelerar, reposicionarse o prolongar una maniobra.
3. Iniciar y sostener derrapes cerca de los objetivos.
4. Encadenar drifts para aumentar la carga del rayo y un multiplicador.
5. Evitar choques y mantener el combo mientras las ruedas levantan temperatura.
6. Liberar el poder del rayo cuando la carga alcanza cierto nivel.
7. Desactivar, quemar o dejar obsoletos a los vehículos alcanzados y cobrar la recompensa.
8. Gastar el dinero obtenido en modificaciones para el GT86.

## Identidad audiovisual

- Dirección estética equilibrada: **JDM × cyberpunk, 50/50**. Ninguna de las dos mitades debe sentirse como un simple decorado de la otra.
- Ciudad distópica permanentemente nocturna, húmeda, oscura y llena de neón, autopistas urbanas, infraestructura eléctrica y vigilancia tecnológica.
- Estética JDM y tuning japonés de los años noventa, los 2000 y sus herederos modernos.
- Tuning callejero exagerado: bodykits, alerones, vinilos, llantas, underglow y escapes visibles.
- Autos inspirados en leyendas japonesas del tuning y el drift, como el Toyota GT86, Nissan Silvia y otros modelos asociados a esa cultura. Haber aparecido en la saga *Need for Speed Underground* es una referencia especialmente valiosa, aunque no un requisito.
- Contraste entre los autos eléctricos, limpios, homogéneos y conectados a la red, y el Rayo Bandido, mecánico, ruidoso, analógico e impredecible.
- Humo, marcas de neumático, chispas, fuego y arcos eléctricos que intensifican visualmente cada combo.
- Sonido del motor como elemento rebelde en un mundo casi silencioso.
- Señalética holográfica, megacorporaciones, cables, transformadores, drones y propaganda que hagan sentir el control tecnológico del mundo.

## Primer auto jugable: Toyota GT86

La versión inicial tendrá un solo vehículo jugable: un **Toyota GT86**, elegido por ser el auto real de Juan y una plataforma moderna fuertemente asociada al drift y al tuning japonés.

El modelo 3D debería ser reconocible como GT86 y tener una preparación visual marcada:

- Bodykit ancho y agresivo.
- Fitment bajo, llantas JDM y postura de drift.
- Alerón, difusor y detalles aerodinámicos con personalidad.
- Vinilos o livery propio de Rayo Bandido.
- Underglow y efectos eléctricos/fuego integrados con la mecánica de carga.
- Daño y suciedad visual progresivos, si el alcance técnico lo permite.

Este GT86 funciona como protagonista y referencia de calidad para el prototipo. Los demás autos japoneses pueden incorporarse después sin ser necesarios para validar la experiencia inicial.

## Tono

El tono puede combinar distopía, acción arcade y humor irreverente. No necesita justificar el conflicto con demasiado realismo: la exageración y la personalidad deberían estar por encima de una simulación seria.

## Rendimiento y dirección gráfica

La fluidez es prioritaria frente a la fidelidad gráfica. El juego debe estar diseñado para correr de manera estable en navegadores modernos sin necesitar hardware de alta gama.

- Se acepta y se favorece una dirección retro, low-poly o estilizada si mejora el rendimiento y refuerza la identidad del juego.
- La estética JDM × cyberpunk debe conservarse mediante siluetas, colores, iluminación, señalética y efectos selectivos, no mediante realismo costoso.
- Se deben limitar polígonos, materiales, luces dinámicas, reflejos, transparencias, partículas y distancia de dibujado.
- Los assets y efectos deben prepararse con presupuestos explícitos de rendimiento.
- La optimización es una restricción de diseño desde el inicio, no una etapa final de pulido.

## Multijugador

Rayo Bandido debe soportar en el futuro un modo multijugador online. No es obligatorio para el MVP del día 1, que se validará como experiencia single-player.

La primera implementación no debe construir infraestructura multijugador prematuramente, pero sí evitar decisiones que vuelvan imposible incorporarla. En particular, conviene mantener separadas la simulación del vehículo, el estado de gameplay, la entrada del jugador y la presentación visual.

El formato multijugador exacto queda abierto: carreras, drift competitivo, destrucción cooperativa de autos eléctricos o enfrentamientos entre jugadores.

## Preguntas abiertas

- ¿El Rayo Bandido es el auto, su conductor o ambos como una misma leyenda?
- ¿El rayo se dispara manualmente, se activa al cerrar un drift alrededor de un objetivo o encadena automáticamente entre vehículos?
- ¿Los autos eléctricos están vacíos y controlados por una IA, o transportan personas?
- ¿El objetivo es destruirlos físicamente, desactivarlos o liberarlos de una red central?
- ¿La estructura será un mundo abierto pequeño, niveles cerrados o partidas rápidas?
- ¿Habrá persecuciones, carreras contra rivales y jefes además de la destrucción de vehículos?
- ¿Qué pierde el jugador cuando corta el combo, choca o sobrecalienta las ruedas?
- ¿En qué iteración posterior al MVP debería incorporarse el primer prototipo multijugador?
- ¿Cuál será el primer modo multijugador: carrera, puntuación de drift, cooperativo o combate?
- ¿Cuántos jugadores debe soportar inicialmente?
- ¿El nitro se recarga solo por tiempo, por velocidad/distancia recorrida o mediante acciones específicas además del drift?
- ¿Las modificaciones compradas con dinero cambian estadísticas, apariencia, poderes o las tres cosas?

## Principio de diseño

Cada sistema importante debería reforzar la misma fantasía: **cuanto mejor drifteás, más peligroso, espectacular y poderoso se vuelve el Rayo Bandido**.
