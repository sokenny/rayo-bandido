# Rayo Bandido — Dirección visual aprobada

## Norte visual

La segunda imagen conceptual generada durante la conversación queda aprobada como la referencia principal del MVP. Define un nivel gráfico deliberadamente estilizado y alcanzable en Three.js: low-poly cuidado, arquitectura modular, iluminación mayormente horneada o emisiva, pocos vehículos, partículas limitadas y una identidad fuerte sostenida por color y silueta.

La mezcla debe sentirse **50% JDM y 50% cyberpunk**. El resultado es oscuro, nocturno, distópico y callejero, pero siempre legible a velocidad.

## Cámara aprobada

Referencia: captura de conducción estilo arcade nocturno aportada por Juan.

- Cámara chase baja, centrada y relativamente cercana.
- El auto ocupa aproximadamente el cuarto inferior central de la pantalla.
- Debe verse suficiente calle para anticipar curvas, tránsito y objetivos.
- Seguimiento suave con un pequeño retraso lateral durante el drift.
- La cámara acompaña parcialmente la dirección real del movimiento, no solo la orientación del auto.
- El FOV aumenta moderadamente con el nitro.
- Vibración sutil en aceleraciones, impactos y descarga del rayo.

## Moodboard aportado

### Referencia 1 — Autopista cyberpunk monumental

Archivo: `1c436aeb-e292-462b-af50-cfbce6091423.png`

Tomar:

- Sensación de velocidad nocturna.
- Autopistas anchas y limpias atravesando una megaciudad.
- Iluminación azul/cian y rojo como guías visuales.
- Escala vertical de edificios y estructuras elevadas.
- Elementos holográficos grandes usados como hitos distantes.

Simplificar para el MVP:

- Los hologramas deben ser planos emisivos o billboards, no simulaciones volumétricas.
- Los edificios lejanos pueden ser bloques con ventanas emisivas repetidas.
- Evitar tráfico denso y reflejos complejos.

### Referencia 2 — Carretera mojada y portales de neón

Archivo: `0ba3bb55-f259-4a14-8a63-7bffb051f32d.png`

Tomar:

- Ruta oscura con iluminación selectiva y gran contraste.
- Portales o marcadores verticales de neón que organizan el recorrido.
- Asfalto húmedo como superficie principal.
- Auto JDM preparado y reconocible por su silueta.
- Interfaz mínima y flotante.

Simplificar para el MVP:

- Usar un material de asfalto con rugosidad y reflejo aproximado, sin reflexiones en tiempo real costosas.
- Reutilizar un pequeño conjunto de postes y luces.
- Mantener bloom y aberraciones en niveles bajos para conservar legibilidad.

### Referencia 3 — Callejón/taller JDM cyberpunk

Archivo: `8727a8bd-1cbf-421a-baa6-ddab56962171.png`

Tomar:

- La fusión más explícita entre cultura de autos japoneses y distopía cyberpunk.
- Talleres clandestinos, callejones industriales, tuberías, cables, grafiti, basura y señalética.
- Paleta magenta, rosa y cian (el verde ácido de la referencia se descarta: ver *Paleta aprobada*).
- Autos modificados como objetos rebeldes, imperfectos y analógicos.
- Sensación de mundo vivido, marginal y fuera del control corporativo.

Simplificar para el MVP:

- Concentrar esta densidad de props en zonas pequeñas como garage, spawn o punto de modificación.
- Resolver muchos detalles con texturas, decals y planos, no geometría individual.
- Usar módulos repetibles para tuberías, aires acondicionados, carteles y barreras.

## Paleta aprobada (revisión de atmósfera)

Referencia de atmósfera aportada por Juan: calle nocturna asiática bajo neblina azul-turquesa,
neón rosa/magenta contra cian, asfalto mojado con reflejos largos. Esa imagen manda sobre las
notas de paleta anteriores.

**Dos familias, nada más.** Toda la arena se construye con una familia fría (cian, azul,
blanco helado) y una caliente (magenta, rosa), con el violeta como único puente. No hay verde,
ámbar ni rojo en el mundo: una calle nocturna se lee como *atmósfera* cuando el ojo tiene dos
colores que ubicar, y como ruido cuando tiene seis.

- Base: **nunca negro puro.** Toda sombra toca fondo en un azul-turquesa (`PAL.fog`), que es
  también el color del cielo, del plano de suelo y del skyline lejano. La distancia se disuelve
  en color, no en vacío.
- Energía/rayo: cian y azul eléctrico casi blanco.
- Nitro y tuning: magenta/violeta.
- Zonas: las tres se distinguen por **qué familia domina**, no agregando una tercera.
  Corporativo = cian/azul; urbano = cian contra magenta; JDM = magenta/rosa con un acento cian
  de contrapunto.
- Ventanas: pocas, grandes y suaves, con halo alrededor. Una torre debe leerse como un par de
  bandas encendidas vistas a través de la neblina, no como cien píxeles peleando entre sí.
- Los halos son anchos y tenues antes que chicos y brillantes: la luz se derrama, no puntea.

El neón debe ser selectivo. Si todo emite luz, nada funciona como foco visual. Corolario
práctico: nada de cadenas de lucecitas (balizas de antena, reflectores punteados, lámparas
colgadas de cada cable); una luz debe ser un evento.

## Lenguaje del mundo

La ciudad debe alternar entre tres tipos de espacio:

1. **Autopistas corporativas:** limpias, anchas, rápidas y vigiladas.
2. **Calles urbanas:** húmedas, oscuras, modulares y con señalética cyberpunk.
3. **Zonas clandestinas JDM:** talleres, callejones, grafiti, cables y modificaciones.

Para el MVP se puede construir un circuito pequeño que atraviese versiones compactas de los tres espacios.

## Nivel gráfico objetivo

- Low-poly estilizado, similar a un juego arcade de principios de los 2000 remasterizado.
- Calidad visual proveniente de composición, paleta, iluminación y efectos clave.
- Edificios modulares y repetibles.
- Texturas compactas y art-directed, no fotorrealistas.
- Pocas luces dinámicas y sombras limitadas.
- Ventanas, carteles y hologramas resueltos con materiales emisivos.
- Humo, chispas, nitro y rayo mediante pools pequeños de partículas.
- Reflejos del asfalto aproximados; evitar ray tracing o espejos en tiempo real.

## Gameplay visual ya decidido

- Drift inicial más fácil y permisivo que en *Need for Speed Underground 2*.
- Rayo autoapuntado al auto eléctrico más cercano dentro de un cono frontal.
- El arco debe conectar claramente al GT86 con el objetivo y poder encadenarse entre vehículos próximos.
- Nitro con aumento moderado de FOV, escape visible y acento magenta/violeta.
- El rayo usa cian/azul eléctrico para diferenciarse del nitro.

## Evitar

- Fotorrealismo o apariencia AAA como objetivo del MVP.
- Exceso de bloom, niebla o aberración cromática.
- Calles tan oscuras que dificulten anticipar el camino.
- Cyberpunk genérico sin cultura automotriz japonesa.
- JDM nostálgico sin distopía tecnológica.
- Demasiados carteles, partículas, luces dinámicas o vehículos simultáneos.
- Copiar interfaces, logos, mapas, circuitos o assets reconocibles de juegos existentes.

