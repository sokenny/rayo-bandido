import type { MicroSceneDefinition } from '../types';

/**
 * TWO PEOPLE PHOTOGRAPHING A TUNED COUPE. The nearest thing in the city to the player's own world:
 * an old combustion coupe on the kerb, somebody crouched over the camber, somebody else filming it
 * before it gets confiscated.
 *
 * The neon on it is EMISSIVE MATERIAL, not a light. The lot at the meet already proved that a
 * parked car glowing at night needs no lamp of its own, and a micro-scene is not the place to
 * start adding shadow casters.
 */
export const TUNED_CAR_PHOTOGRAPHERS: MicroSceneDefinition = {
  id: 'tuned-car-photographers',
  title: 'Sesión de fotos al tuneado',
  description: 'A customized combustion coupe on the kerb with two people photographing and arguing over it.',
  category: 'car-culture',
  tags: ['civilian', 'car-culture', 'photography', 'combustion'],

  compatibleAnchorTypes: ['roadside', 'lay-by', 'commercial', 'industrial-alley'],
  requiredAnchorTags: ['roadside'],
  weight: 8,
  cooldownSeconds: 230,

  spawnDistance: 175,
  activationDistance: 100,
  dialogueDistance: 40,
  despawnDistance: 215,

  actors: [
    {
      id: 'fotografo',
      slot: 0,
      offset: { x: 2.7, z: 0.95, heading: -2.3 },
      cast: 'crew',
      voice: 'npc-masculino-1',
      act: 'film',
      behaviors: ['inspectObject', 'lookAtPassingVehicle', 'alternateSpeakerGestures'],
      seed: 3081,
    },
    {
      id: 'amigo',
      slot: 1,
      offset: { x: -1.4, z: 0.85, heading: 2.4 },
      cast: 'civilian-m',
      voice: 'npc-masculino-2',
      act: 'inspect',
      behaviors: ['inspectObject', 'alternateSpeakerGestures', 'lookAtPassingVehicle'],
      seed: 9520,
    },
  ],

  props: [
    {
      id: 'cupe',
      kind: 'tuned-coupe',
      slot: 0,
      offset: { x: 0, z: -0.95, heading: 1.5707963267948966 },
      color: 0x1d2536,
      emissive: 0xff2fb4,
    },
  ],

  sharedBehaviors: [],

  ambientSequence: [
    { id: 'crouch-for-the-shot', seconds: [3.5, 6], actor: 'fotografo', behavior: 'inspectObject' },
    { id: 'point-at-camber', seconds: [3, 5], actor: 'amigo', behavior: 'inspectObject' },
    { id: 'step-back-and-frame', seconds: [2.5, 4.5], actor: 'fotografo', behavior: 'alternateSpeakerGestures' },
  ],

  dialogueVariants: [
    {
      id: 'still-petrol',
      label: '¿Esto todavía anda a nafta?',
      weight: 10,
      lines: [
        { speaker: 'fotografo', clip: 'tuned_a_1', text: '¿Esto todavía anda a nafta?' },
        { speaker: 'amigo', clip: 'tuned_a_2', text: 'Sí. Escuchalo arrancar y te olvidás de esas licuadoras.' },
        { speaker: 'fotografo', clip: 'tuned_a_3', text: 'Sacame una foto antes de que lo decomisen.' },
      ],
    },
    {
      id: 'the-camber',
      label: 'Se come las cubiertas',
      weight: 10,
      lines: [
        { speaker: 'amigo', clip: 'tuned_b_1', text: 'Mirá esa caída. Se debe comer las cubiertas.' },
        { speaker: 'fotografo', clip: 'tuned_b_2', text: '¿Y? Hay gente que gasta plata en cosas más tristes.' },
        { speaker: 'amigo', clip: 'tuned_b_3', text: 'Bueno, corréte que me tapás la llanta.' },
      ],
    },
    {
      id: 'limiter-deleted',
      label: 'Dicen que tiene el limitador borrado',
      weight: 10,
      lines: [
        { speaker: 'fotografo', clip: 'tuned_c_1', text: 'Dicen que tiene el limitador borrado.' },
        { speaker: 'amigo', clip: 'tuned_c_2', text: 'Dicen cualquier cosa. El dueño no pasa de segunda.' },
        { speaker: 'fotografo', clip: 'tuned_c_3', text: 'Callate, ahí viene alguien.', direction: '[low]' },
      ],
    },
  ],

  reactions: [
    {
      id: 'that-one-uses-it',
      trigger: 'aggressivePass',
      priority: 3,
      seconds: 4,
      behaviors: ['lookAtPlayer', 'lookAtPassingVehicle'],
      lines: [
        { speaker: 'fotografo', clip: 'tuned_react_1', text: '¡Ese sí lo usa!', direction: '[excited]', gapAfter: 0.25 },
        { speaker: 'amigo', clip: 'tuned_react_2', text: 'Guardá el celu, boludo.', direction: '[urgent]' },
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
