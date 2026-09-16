import type { MicroSceneDefinition } from '../types';

/**
 * THREE PEOPLE UNDER THE BRIDGE, passing a joint. Relaxed and incidental — a corner of the city
 * somebody else is already using — and deliberately not a drug mission: no prompt, no interaction,
 * nothing to walk up to.
 *
 * THE JOINT IS ONE OBJECT. The ambient loop hands it from one person to the next, `passSmallProp`
 * shows it in exactly one hand at a time, and the renderer carries the prop itself along the same
 * `propTransfer` the behaviour reads — so it can never be in two hands and can never be in none.
 *
 * A patrol coming near puts it away and the talk stops; they pick up again a randomized while
 * after the police have gone, which is what `resumeAfterDelay` is for.
 */
export const BRIDGE_SMOKE_CIRCLE: MicroSceneDefinition = {
  id: 'bridge-smoke-circle',
  title: 'Ronda bajo el puente',
  description: 'Three people leaning on a ledge under the viaduct, passing a joint and talking about engines.',
  category: 'civilian',
  tags: ['civilian', 'casual', 'bridge', 'nightlife', 'police-reactive'],

  compatibleAnchorTypes: ['under-bridge', 'under-highway', 'dark-corner'],
  requiredAnchorTags: ['dark'],
  weight: 6,
  cooldownSeconds: 300,

  spawnDistance: 160,
  activationDistance: 90,
  dialogueDistance: 36,
  despawnDistance: 200,

  actors: [
    {
      id: 'sentado',
      slot: 0,
      offset: { x: -1.35, z: 0.5, heading: 0.9 },
      cast: 'civilian-m',
      voice: 'npc-masculino-1',
      act: 'stand',
      seated: true,
      behaviors: ['idleConversation', 'passSmallProp', 'watchForPolice', 'hideHeldObject', 'lookAtPassingVehicle', 'resumeAfterDelay'],
      holds: 'faso',
      seed: 8802,
    },
    {
      id: 'apoyado',
      slot: 1,
      offset: { x: 0.25, z: 0.95, heading: -0.2 },
      cast: 'civilian-m',
      voice: 'npc-masculino-2',
      act: 'stand',
      behaviors: ['idleConversation', 'passSmallProp', 'watchForPolice', 'hideHeldObject', 'lookAtPassingVehicle', 'resumeAfterDelay'],
      seed: 1246,
    },
    {
      id: 'parado',
      slot: 2,
      offset: { x: 1.55, z: 0.3, heading: -0.95 },
      cast: 'crew',
      voice: 'npc-masculino-1',
      act: 'chat',
      behaviors: ['idleConversation', 'alternateSpeakerGestures', 'passSmallProp', 'watchForPolice', 'hideHeldObject', 'resumeAfterDelay'],
      seed: 3459,
    },
  ],

  props: [
    { id: 'cornisa', kind: 'ledge', slot: 0, offset: { x: 0, z: 1.35, heading: 0 }, color: 0x4a4e55 },
    { id: 'cajon', kind: 'crate', slot: 1, offset: { x: -1.95, z: 1.1, heading: 0.4 }, color: 0x6b5a42 },
    // The only lit thing in the scene, and it is an emissive tip a centimetre across.
    { id: 'faso', kind: 'joint', slot: -1, offset: { x: 0, y: 0, z: 0, heading: 0 }, emissive: 0xff7a2a, transferable: true },
  ],

  sharedBehaviors: ['emitLightSmoke'],

  /**
   * The ring: a drag, a pass, the next person taking it with the other hand, somebody making a
   * point, and an irregular pause before it goes round again.
   */
  ambientSequence: [
    { id: 'drag', seconds: [2, 3.5], actor: 'sentado', behavior: 'emitLightSmoke' },
    { id: 'pass-to-apoyado', seconds: [1.4, 2.2], actor: 'sentado', behavior: 'passSmallProp', prop: 'faso', to: 'apoyado' },
    { id: 'drag-2', seconds: [2, 3.5], actor: 'apoyado', behavior: 'emitLightSmoke' },
    { id: 'gesture', seconds: [2.5, 4.5], actor: 'parado', behavior: 'idleConversation' },
    { id: 'pass-to-parado', seconds: [1.4, 2.2], actor: 'apoyado', behavior: 'passSmallProp', prop: 'faso', to: 'parado' },
    { id: 'cough', seconds: [1.5, 3], actor: 'parado', behavior: 'lookAtPassingVehicle' },
    { id: 'pass-back', seconds: [1.6, 2.6], actor: 'parado', behavior: 'passSmallProp', prop: 'faso', to: 'sentado' },
    { id: 'lull', seconds: [2, 5.5], behavior: 'idleConversation' },
  ],

  dialogueVariants: [
    {
      id: 'dont-interview-it',
      label: 'Pasalo, no lo entrevistes',
      weight: 10,
      lines: [
        { speaker: 'sentado', clip: 'smoke_a_1', text: 'Pasalo, no lo entrevistes.' },
        { speaker: 'apoyado', clip: 'smoke_a_2', text: 'Pará, pega distinto acá abajo.' },
        { speaker: 'parado', clip: 'smoke_a_3', text: 'Eso es el plomo del puente, boludo.', direction: '[dry]' },
      ],
    },
    {
      id: 'a-real-engine',
      label: 'Uno de verdad',
      weight: 10,
      conditions: [{ kind: 'playerCombustionCar' }],
      lines: [
        { speaker: 'apoyado', clip: 'smoke_b_1', text: '¿Escucharon ese motor?' },
        { speaker: 'sentado', clip: 'smoke_b_2', text: 'Sí. Uno de verdad.' },
        { speaker: 'parado', clip: 'smoke_b_3', text: 'Bueno, brindemos antes de que lo prohíban.' },
      ],
    },
    {
      id: 'the-drone',
      label: 'Ese dron está hace diez minutos',
      weight: 10,
      lines: [
        { speaker: 'parado', clip: 'smoke_c_1', text: 'Ese dron está hace diez minutos ahí.' },
        { speaker: 'apoyado', clip: 'smoke_c_2', text: 'Capaz nos está grabando.' },
        { speaker: 'sentado', clip: 'smoke_c_3', text: 'Capaz está esperando que convides.', direction: '[amused]' },
      ],
    },
  ],

  reactions: [
    {
      id: 'nearly-swallowed-it',
      trigger: 'aggressivePass',
      priority: 3,
      seconds: 4,
      behaviors: ['lookAtPlayer'],
      lines: [
        { speaker: 'apoyado', clip: 'smoke_react_1', text: 'Uh, amigo, casi me hacés tragar el faso.', gapAfter: 0.3 },
        { speaker: 'sentado', clip: 'smoke_react_2', text: 'Cuidalo, que queda poco.', direction: '[dry]' },
      ],
    },
    {
      id: 'put-it-away',
      trigger: 'policeNear',
      priority: 5,
      seconds: 5.5,
      resumeAfter: [5, 11],
      behaviors: ['hideHeldObject', 'watchForPolice', 'resumeAfterDelay'],
      lines: [
        { speaker: 'sentado', clip: 'smoke_police_1', text: 'Guardá, guardá. Después seguimos.', direction: '[low, urgent]' },
      ],
      once: false,
    },
  ],

  interruptionPolicy: {
    onPriorityAudio: 'fade',
    onPlayerLeaves: 'fade',
    reactionInterrupts: true,
    resumeAfterReaction: true,
  },

  performanceBudget: {
    maxActors: 3,
    maxAnimatedActors: 3,
    maxParticles: 16,
    allowsDynamicLights: false,
    allowsPhysics: false,
  },

  status: 'needs-audio',
};
