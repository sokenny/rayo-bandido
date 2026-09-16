import type { MicroSceneDefinition } from '../types';

/**
 * DOUBLE PARKED, hazards on, two minutes that have been forty. A cheap electric hatch across a bus
 * bay or a charger, the driver still in it, and somebody at the window who has had enough.
 *
 * The one scene that answers the HORN, which is a signal the game already has: leaning on it gets
 * the driver shouting back that he is moving it, which he is not.
 */
export const DOUBLE_PARKING_ARGUMENT: MicroSceneDefinition = {
  id: 'double-parking-argument',
  title: 'Discusión por mal estacionado',
  description: 'A double-parked electric hatch, hazards blinking, and a pedestrian arguing through the window.',
  category: 'civilian',
  tags: ['civilian', 'argument', 'vehicle', 'commercial'],

  compatibleAnchorTypes: ['commercial', 'roadside', 'lay-by'],
  requiredAnchorTags: ['commercial'],
  weight: 9,
  cooldownSeconds: 200,

  spawnDistance: 165,
  activationDistance: 95,
  dialogueDistance: 38,
  despawnDistance: 205,

  actors: [
    {
      id: 'peaton',
      slot: 0,
      offset: { x: 1.75, z: 0.75, heading: -2.1 },
      cast: 'civilian-m',
      voice: 'npc-masculino-1',
      act: 'chat',
      behaviors: ['alternateSpeakerGestures', 'lookAtPlayer', 'stepAwayFromRoad'],
      seed: 1189,
    },
    {
      id: 'chofer',
      slot: 1,
      // In the driver's seat: seated, at the window of the hatch beside him.
      offset: { x: 0.75, y: 0.55, z: -0.85, heading: 1.5 },
      cast: 'driver',
      voice: 'npc-masculino-2',
      act: 'stand',
      seated: true,
      behaviors: ['alternateSpeakerGestures', 'lookAtPlayer'],
      seed: 6702,
    },
  ],

  props: [
    {
      id: 'hatch',
      kind: 'civilian-ev',
      slot: 0,
      offset: { x: 0, z: -0.95, heading: 1.5707963267948966 },
      color: 0xc9cbd0,
      hazards: true,
    },
  ],

  sharedBehaviors: ['playVehicleHazards'],

  ambientSequence: [
    { id: 'point-at-bay', seconds: [3, 5], actor: 'peaton', behavior: 'alternateSpeakerGestures' },
    { id: 'hands-off-wheel', seconds: [3, 5.5], actor: 'chofer', behavior: 'alternateSpeakerGestures' },
    { id: 'hazards', seconds: [2.5, 4], prop: 'hatch', behavior: 'playVehicleHazards' },
  ],

  dialogueVariants: [
    {
      id: 'bus-bay',
      label: 'Tapaste toda la parada',
      weight: 10,
      lines: [
        { speaker: 'peaton', clip: 'parking_a_1', text: 'Flaco, corré el auto. Tapaste toda la parada.' },
        { speaker: 'chofer', clip: 'parking_a_2', text: 'Tengo balizas, maestro. Son dos minutos.' },
        { speaker: 'peaton', clip: 'parking_a_3', text: 'Ah, tenés balizas. Entonces desapareció el auto.', direction: '[sarcastic]' },
      ],
    },
    {
      id: 'nearly-hit-me',
      label: 'Casi me llevás puesto',
      weight: 10,
      lines: [
        { speaker: 'peaton', clip: 'parking_b_1', text: '¡Casi me llevás puesto, enfermo!', direction: '[raised]' },
        { speaker: 'chofer', clip: 'parking_b_2', text: 'Cruzaste mirando el implante, ¿qué querés que haga?' },
        { speaker: 'peaton', clip: 'parking_b_3', text: 'Frenar. Es una función que todavía traen.', direction: '[dry]' },
      ],
    },
    {
      id: 'charger-hog',
      label: 'Cuarenta minutos en el cargador',
      weight: 10,
      lines: [
        { speaker: 'peaton', clip: 'parking_c_1', text: 'Hace cuarenta minutos que ocupás el cargador.' },
        { speaker: 'chofer', clip: 'parking_c_2', text: 'Está actualizando. No me deja moverlo.' },
        { speaker: 'peaton', clip: 'parking_c_3', text: 'Hermoso el futuro. Ahora el auto te estaciona a vos.', direction: '[dry]' },
      ],
    },
  ],

  reactions: [
    {
      id: 'horn-back',
      trigger: 'horn',
      priority: 3,
      seconds: 3.4,
      behaviors: ['lookAtPlayer'],
      lines: [
        {
          speaker: 'chofer',
          clip: 'parking_react_horn',
          text: '¡Sí, sí, ya lo corro! ¡Pasá por arriba si querés!',
          direction: '[shouting]',
        },
      ],
    },
  ],

  interruptionPolicy: {
    onPriorityAudio: 'fade',
    onPlayerLeaves: 'fade',
    reactionInterrupts: true,
    resumeAfterReaction: true,
  },

  performanceBudget: {
    maxActors: 2,
    maxAnimatedActors: 2,
    maxParticles: 0,
    allowsDynamicLights: false,
    allowsPhysics: false,
  },

  status: 'needs-audio',
};
