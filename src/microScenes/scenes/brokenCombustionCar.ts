import type { MicroSceneDefinition } from '../types';

/**
 * A COMBUSTION CAR THAT WILL NOT START, at the kerb with its bonnet up, and two people who do not
 * agree about why. The city's other petrol car, and the quiet argument for the player's: this is
 * what happens to one of these when the grid decides it has had enough of it.
 *
 * The steam is intermittent and pooled, and it stops while the police are about — which is the
 * only reason `emitLightSmoke` is a shared block rather than something the bonnet does on its own.
 */
export const BROKEN_COMBUSTION_CAR: MicroSceneDefinition = {
  id: 'broken-combustion-car',
  title: 'Auto a nafta varado',
  description: 'A stalled combustion car with its hood up, two people arguing about the inhibitor.',
  category: 'vehicle',
  tags: ['civilian', 'vehicle', 'combustion', 'roadside'],

  compatibleAnchorTypes: ['roadside', 'lay-by', 'commercial', 'industrial-alley'],
  requiredAnchorTags: ['roadside'],
  weight: 8,
  cooldownSeconds: 240,

  spawnDistance: 180,
  activationDistance: 100,
  dialogueDistance: 40,
  despawnDistance: 220,

  actors: [
    {
      id: 'mecanico',
      slot: 0,
      offset: { x: -1.95, z: 0.35, heading: 1.9 },
      cast: 'mechanic',
      voice: 'npc-masculino-1',
      act: 'inspect',
      behaviors: ['inspectObject', 'alternateSpeakerGestures', 'lookAtPassingVehicle'],
      seed: 9013,
    },
    {
      id: 'dueno',
      slot: 1,
      offset: { x: 0.35, z: 1.05, heading: -2.4 },
      cast: 'driver',
      voice: 'npc-masculino-2',
      act: 'stand',
      behaviors: ['alternateSpeakerGestures', 'inspectObject', 'lookAtPassingVehicle'],
      holds: 'repuesto',
      seed: 3377,
    },
  ],

  props: [
    // Two wheels in the gutter, the way a car that stopped where it stopped ends up. `smokes`
    // puts the bonnet up and the steam at its nose: one prop, so the two can never disagree.
    {
      id: 'coche',
      kind: 'combustion-car',
      slot: 0,
      offset: { x: 0, z: -0.95, heading: 1.5707963267948966 },
      color: 0x7a3320,
      smokes: true,
      // Hazards on, the way a car that has died in traffic sits. It is also the only thing that
      // makes an unlit body read at all on a wet street at night.
      hazards: true,
    },
    { id: 'repuesto', kind: 'crate', slot: -1, offset: { x: 0, y: 0, z: 0, heading: 0 }, color: 0x2f3a46 },
  ],

  sharedBehaviors: ['emitLightSmoke', 'playVehicleHazards'],

  ambientSequence: [
    { id: 'lean-in', seconds: [4, 7], actor: 'mecanico', behavior: 'inspectObject' },
    { id: 'hold-out-part', seconds: [3, 5], actor: 'dueno', behavior: 'inspectObject' },
    { id: 'steam', seconds: [2, 4], prop: 'coche', behavior: 'emitLightSmoke' },
    { id: 'straighten', seconds: [3, 5], actor: 'dueno', behavior: 'alternateSpeakerGestures' },
  ],

  dialogueVariants: [
    {
      id: 'try-again',
      label: 'La computadora lo bloquea',
      weight: 10,
      lines: [
        { speaker: 'mecanico', clip: 'broken_a_1', text: 'Probá de nuevo.' },
        { speaker: 'dueno', clip: 'broken_a_2', text: 'Ya probé tres veces. La computadora lo está bloqueando.' },
      ],
    },
    {
      id: 'inhibitor',
      label: '¿Quién le puso un inhibidor?',
      weight: 10,
      lines: [
        { speaker: 'mecanico', clip: 'broken_b_1', text: 'No es el motor, es el inhibidor.' },
        {
          speaker: 'dueno',
          clip: 'broken_b_2',
          text: '¿Y quién mierda le puso un inhibidor a este cacharro?',
          direction: '[exasperated]',
        },
      ],
    },
    {
      id: 'the-checkpoint',
      label: 'Te dije que no pasaras por el control',
      weight: 10,
      lines: [
        { speaker: 'mecanico', clip: 'broken_c_1', text: 'Te dije que no pasaras por el control.' },
        { speaker: 'dueno', clip: 'broken_c_2', text: 'Sí, buenísimo. Ahora ayudame a hacerlo arrancar.', direction: '[dry]' },
      ],
    },
  ],

  reactions: [
    {
      id: 'one-that-still-runs',
      trigger: 'slowPass',
      priority: 2,
      seconds: 4,
      behaviors: ['lookAtPassingVehicle'],
      conditions: [{ kind: 'playerCombustionCar' }],
      lines: [
        { speaker: 'mecanico', clip: 'broken_react_1', text: 'Mirá, uno que todavía anda.' },
        { speaker: 'dueno', clip: 'broken_react_2', text: 'Sí, hasta que lo detecten.', direction: '[dry]' },
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
    maxParticles: 24,
    allowsDynamicLights: false,
    allowsPhysics: false,
  },

  status: 'needs-audio',
};
