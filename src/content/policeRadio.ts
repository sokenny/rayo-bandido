/**
 * THE POLICE RADIO: what the chasers say to Central while they are after the car.
 *
 * DATA, NOT LOGIC. The rules for when each moment is heard live in `src/audio/policeRadio.ts`;
 * this is only the copy, per moment. Written in Rioplatense and spoken exactly as written — the
 * exclamation marks and the ellipsis are part of the delivery, so nothing here is sanitised.
 *
 * VOICE. `policia` (`server/dialogue/voices.mjs`): a CLEAN Instant Voice clone with no radio in
 * it. The agitation comes from its TTS settings (low stability, high style); the walkie-talkie
 * comes from the FX chain the clip plays through in `src/audio/policeRadio.ts`.
 */
export const POLICE_RADIO_LINES = {
  rayShot: [
    "Central, el hijo de puta está descargando contra los vehículos.",
    "Ahí va de nuevo con el rayito de mierda.",
    "Volvió a disparar. Mantengan distancia, cambio.",
  ],

  drift: [
    "Entra de costado en todas las esquinas. Ciérrenle la próxima antes de que se mate este pelotudo.",
    "Mirá cómo dobla el enfermo este. Va más de costado que derecho.",
    "Tiene la cola más suelta que tu hermana. Mirá cómo se cruza el hijo de puta.",
  ],

  hardCrash: [
    "¡Se la puso!... No, sigue. ¿Cómo mierda sigue andando?",
    "Impacto fuerte. Sigue en movimiento, cambio.",
    "Se hizo mierda y sigue como si nada.",
  ],

  repeatedCrash: [
    "Choca todo el hijo de puta. Parece Chano buscando estacionamiento.",
    "Este no maneja, rebota. Cambio.",
    "Está haciendo mierda todo lo que toca.",
  ],

  hitPolice: [
    "Me chocó el móvil, la concha de su madre.",
    "Impactó contra un patrullero. Sigue la persecución.",
    "Le pegó al móvil y siguió como si nada. Forro.",
  ],

  highSpeed: [
    "Va como un enfermo. No intenten cruzársele de frente.",
    "Está aumentando la velocidad. Mantengan distancia, cambio.",
    "Se nos va. Metan pata.",
  ],

  policeClose: [
    "Lo tengo pegado adelante. Como frene, me lo pongo de sombrero al hijo de puta.",
    "Lo tengo a metros. Mantengo contacto, cambio.",
    "Estoy encima. No lo pierdo.",
  ],

  lostSight: [
    "Lo perdí de vista. Que no se escape este forro.",
    "¿Dónde mierda se metió? Lo tenía acá nomás y se me borró.",
    "Sin visual. Sigo buscando, cambio.",
  ],

  activePursuit: [
    "Central, seguimos atrás del pelotudo este. Nosotros ya parecemos sus guardaespaldas.",
    "Continuamos en persecución. Sin novedades, cambio.",
    "No afloja el forro. Nosotros tampoco.",
  ],
} as const;

export type PoliceRadioTrigger = keyof typeof POLICE_RADIO_LINES;
