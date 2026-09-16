import type { MicroSceneDefinition } from '../types';

/**
 * A FOLDING TABLE OF PARTS THAT CAME FROM SOMEWHERE. A tarp, two boxes, a battery lamp, and a
 * vendor who would rather you did not ask. The customer is not the player and never will be:
 * there is no prompt, no price, no inventory and no commerce here — this is a conversation you
 * drive past, and the only thing the player's presence changes is what gets said about their car.
 *
 * It is the scene that reacts to the POLICE rather than to the player: a patrol coming near puts
 * the table under the tarp and the talk stops, and it picks up again a while after they have gone.
 */
export const ILLEGAL_PARTS_STAND: MicroSceneDefinition = {
  id: 'illegal-parts-stand',
  title: 'Puesto de repuestos',
  description: 'A folding table of modified parts on the pavement, a vendor and a customer who knows better than to ask.',
  category: 'commerce',
  tags: ['civilian', 'commerce', 'illegal', 'police-reactive'],

  compatibleAnchorTypes: ['commercial', 'roadside', 'lay-by', 'industrial-alley', 'dark-corner'],
  requiredAnchorTags: ['wide-sidewalk'],
  weight: 7,
  cooldownSeconds: 260,

  spawnDistance: 175,
  activationDistance: 100,
  dialogueDistance: 40,
  despawnDistance: 215,

  actors: [
    {
      id: 'vendedor',
      slot: 0,
      offset: { x: -0.95, z: 0.95, heading: 3.0 },
      cast: 'vendor',
      voice: 'npc-masculino-1',
      act: 'vendor',
      behaviors: ['inspectObject', 'coverTable', 'watchForPolice', 'lookAtPassingVehicle', 'hideHeldObject', 'resumeAfterDelay'],
      seed: 4498,
    },
    {
      id: 'cliente',
      slot: 1,
      offset: { x: 1.05, z: -0.85, heading: 0.15 },
      cast: 'civilian-m',
      voice: 'npc-masculino-2',
      act: 'inspect',
      behaviors: ['inspectObject', 'alternateSpeakerGestures', 'watchForPolice', 'resumeAfterDelay'],
      holds: 'pieza',
      seed: 7712,
    },
  ],

  props: [
    { id: 'mesa', kind: 'table', slot: 0, offset: { x: 0, z: 0.15, heading: 0 }, color: 0x3a3f47 },
    { id: 'lona', kind: 'tarp', slot: -1, offset: { x: 0, y: 0.92, z: 0.15, heading: 0 }, color: 0x2a3b33 },
    { id: 'cajas', kind: 'boxes', slot: 1, offset: { x: -1.75, z: 0.7, heading: 0.3 }, color: 0x6b5a42 },
    // A battery lamp: emissive material only, never a dynamic light.
    { id: 'farol', kind: 'lamp', slot: 2, offset: { x: 1.0, y: 0.9, z: 0.55, heading: 0 }, emissive: 0xffd9a0 },
    { id: 'pieza', kind: 'crate', slot: -1, offset: { x: 0, y: 0, z: 0, heading: 0 }, color: 0x8a6a2a },
  ],

  sharedBehaviors: [],

  ambientSequence: [
    { id: 'turn-part-over', seconds: [3.5, 6], actor: 'cliente', behavior: 'inspectObject' },
    { id: 'lay-it-out', seconds: [3, 5], actor: 'vendedor', behavior: 'inspectObject' },
    { id: 'glance-down-street', seconds: [2.5, 5], actor: 'vendedor', behavior: 'watchForPolice' },
  ],

  dialogueVariants: [
    {
      id: 'with-a-receipt',
      label: '¿Con factura o barato?',
      weight: 10,
      lines: [
        { speaker: 'cliente', clip: 'parts_a_1', text: '¿Y esto de dónde salió?' },
        { speaker: 'vendedor', clip: 'parts_a_2', text: '¿Lo querés con factura o lo querés barato?' },
        { speaker: 'cliente', clip: 'parts_a_3', text: 'Barato.' },
        { speaker: 'vendedor', clip: 'parts_a_4', text: 'Entonces no preguntes boludeces.', direction: '[flat]' },
      ],
    },
    {
      id: 'explains-reality',
      label: 'Le explica la realidad de otra manera',
      weight: 10,
      lines: [
        { speaker: 'cliente', clip: 'parts_b_1', text: 'Me dijeron que esto engaña al control de emisiones.' },
        { speaker: 'vendedor', clip: 'parts_b_2', text: 'No lo engaña. Le explica la realidad de otra manera.' },
        { speaker: 'cliente', clip: 'parts_b_3', text: '¿Y si me paran?' },
        { speaker: 'vendedor', clip: 'parts_b_4', text: 'Ahí la realidad te la explican ellos.', direction: '[dry]' },
      ],
    },
  ],

  reactions: [
    {
      id: 'pack-it-up',
      trigger: 'policeNear',
      priority: 5,
      seconds: 6,
      resumeAfter: [4, 9],
      behaviors: ['coverTable', 'hideHeldObject', 'watchForPolice', 'resumeAfterDelay'],
      lines: [
        { speaker: 'vendedor', clip: 'parts_police_1', text: 'Guardá eso, guardá eso.', direction: '[urgent, low]', gapAfter: 0.25 },
        { speaker: 'cliente', clip: 'parts_police_2', text: 'Pero si todavía no te pagué.' },
        { speaker: 'vendedor', clip: 'parts_police_3', text: 'Mejor. Entonces no nos conocemos.', direction: '[low]' },
      ],
      // The police come and go; this one is allowed to fire again on the next patrol.
      once: false,
    },
    {
      id: 'wont-pass-inspection',
      trigger: 'slowPass',
      priority: 2,
      seconds: 3.5,
      behaviors: ['lookAtPassingVehicle'],
      conditions: [{ kind: 'wantedNone' }],
      lines: [
        {
          speaker: 'vendedor',
          clip: 'parts_react_slow',
          text: 'Ese auto no pasa una revisión ni con un milagro.',
          direction: '[amused]',
        },
      ],
    },
    {
      id: 'not-with-this-mess',
      trigger: 'playerWanted',
      priority: 4,
      seconds: 3.5,
      behaviors: ['hideHeldObject', 'lookAtPlayer'],
      conditions: [{ kind: 'wantedAtLeast', stars: 1 }],
      lines: [
        { speaker: 'vendedor', clip: 'parts_react_wanted', text: 'No, con este quilombo no atiendo.', direction: '[clipped]' },
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
