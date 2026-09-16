import type { MicroSceneDefinition } from '../types';

/**
 * AN EMISSIONS CHECKPOINT: an electric patrol car, a civilian pulled over, and an officer who has
 * heard every excuse. The one scene with police in it, and the one that has to be most careful
 * about what it is NOT.
 *
 * IT HAS NO AUTHORITY. The officer's reaction to a car blown past is a remark, not a call: the
 * wanted system (`src/sim/police.ts`) remains the only thing in the game that can start a pursuit,
 * raise heat or spawn a unit. This scene reads the police state and never writes to it. It does
 * not spawn during a pursuit either — a checkpoint standing calmly in the middle of a chase would
 * read as a bug even though it is only scenery.
 */
export const EMISSIONS_CHECKPOINT: MicroSceneDefinition = {
  id: 'emissions-checkpoint',
  title: 'Control de emisiones',
  description: 'A traffic officer scanning a stopped civilian car that is very obviously not electric.',
  category: 'police',
  tags: ['police', 'vehicle', 'surveillance', 'roadside'],

  compatibleAnchorTypes: ['roadside', 'lay-by', 'commercial'],
  requiredAnchorTags: ['police-compatible'],
  weight: 6,
  cooldownSeconds: 300,

  spawnDistance: 190,
  activationDistance: 110,
  dialogueDistance: 44,
  despawnDistance: 230,

  // Never in the middle of a chase, and not while the player is already wanted: the officer would
  // have somewhere better to be.
  conditions: [{ kind: 'noPursuit' }, { kind: 'wantedNone' }],

  actors: [
    {
      id: 'oficial',
      slot: 0,
      offset: { x: -1.5, z: 0.5, heading: 2.1 },
      cast: 'officer',
      voice: 'npc-policia-1',
      act: 'inspect',
      behaviors: ['inspectObject', 'alternateSpeakerGestures', 'lookAtPassingVehicle'],
      holds: 'escaner',
      seed: 2280,
    },
    {
      id: 'conductor',
      slot: 1,
      offset: { x: 0.2, z: 1.15, heading: -2.5 },
      cast: 'driver',
      voice: 'npc-masculino-2',
      act: 'stand',
      behaviors: ['alternateSpeakerGestures', 'lookAtPassingVehicle'],
      seed: 8115,
    },
  ],

  props: [
    // Both cars along the kerb, nose to tail, with two wheels up on the pavement: the lane stays
    // open. Nothing a micro-scene puts down ever stands in traffic.
    { id: 'patrullero', kind: 'police-ev', slot: 0, offset: { x: 5.6, z: -0.95, heading: 1.5707963267948966 }, emissive: 0x3fd0ff },
    {
      id: 'civil',
      kind: 'civilian-ev',
      slot: 1,
      offset: { x: 0, z: -0.95, heading: 1.5707963267948966 },
      color: 0x8d9299,
      hazards: true,
    },
    { id: 'escaner', kind: 'scanner', slot: -1, offset: { x: 0, y: 0, z: 0, heading: 0 }, emissive: 0x39ff9a },
    { id: 'valla', kind: 'holo-barrier', slot: 2, offset: { x: 3.1, z: 0.6, heading: 0 }, emissive: 0xffb020 },
  ],

  sharedBehaviors: ['playVehicleHazards'],

  ambientSequence: [
    { id: 'scan-plate', seconds: [4, 6.5], actor: 'oficial', behavior: 'inspectObject' },
    { id: 'driver-protests', seconds: [3, 5], actor: 'conductor', behavior: 'alternateSpeakerGestures' },
    { id: 'hazards', seconds: [3, 5], prop: 'civil', behavior: 'playVehicleHazards' },
  ],

  dialogueVariants: [
    {
      id: 'reads-electric',
      label: 'La patente figura eléctrica',
      weight: 10,
      lines: [
        {
          speaker: 'oficial',
          clip: 'checkpoint_a_1',
          text: 'La patente figura eléctrica, pero esto está levantando temperatura.',
        },
        { speaker: 'conductor', clip: 'checkpoint_a_2', text: 'Y… porque la batería es una porquería.' },
        { speaker: 'oficial', clip: 'checkpoint_a_3', text: 'Claro. Y ese olor a nafta debe ser nostalgia.', direction: '[dry]' },
      ],
    },
    {
      id: 'late-for-work',
      label: 'Autonomía económica',
      weight: 10,
      lines: [
        { speaker: 'conductor', clip: 'checkpoint_b_1', text: 'Oficial, llego tarde al laburo. ¿Podemos hacerla corta?' },
        { speaker: 'oficial', clip: 'checkpoint_b_2', text: 'Si quería llegar rápido, no hubiera comprado autonomía económica.' },
        { speaker: 'conductor', clip: 'checkpoint_b_3', text: 'Me quedaban ocho cuotas…', direction: '[deflated]' },
      ],
    },
    {
      id: 'still-vibrating',
      label: 'Apague el vehículo',
      weight: 10,
      lines: [
        { speaker: 'oficial', clip: 'checkpoint_c_1', text: 'Apague el vehículo y autorice el escaneo.' },
        { speaker: 'conductor', clip: 'checkpoint_c_2', text: 'Está apagado.' },
        { speaker: 'oficial', clip: 'checkpoint_c_3', text: 'Entonces explíqueme por qué sigue vibrando.' },
        { speaker: 'conductor', clip: 'checkpoint_c_4', text: 'Es… el aire acondicionado.', direction: '[weak]' },
      ],
    },
  ],

  reactions: [
    {
      id: 'take-the-plate',
      trigger: 'aggressivePass',
      priority: 3,
      seconds: 3.5,
      behaviors: ['lookAtPlayer'],
      // A remark, not a call. Nothing here touches heat, stars or units.
      lines: [
        { speaker: 'oficial', clip: 'checkpoint_react_1', text: 'Anotá la patente, después lo vemos.', direction: '[bored]' },
      ],
    },
  ],

  interruptionPolicy: {
    onPriorityAudio: 'cancel',
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
