import type { MicroSceneDefinition } from '../types';

/**
 * THE BUS STOP. Three people under a shelter the city already built, waiting for a service the
 * board says is late. The commonest micro-scene in Bandido Metro and the one that sets the tone:
 * nothing happens, nobody wants anything, and the player is not in the conversation.
 *
 * THE CASTING VARIES WITH THE STORY. Four bodies are built and three ever stand there: the man
 * watching the avenue is always present, and the bench is either the commuter (the transit
 * variants) or the friend (the infidelity one). That is what lets one shelter be two men griping
 * about the 82 on one appearance and two women mid-story on the next.
 *
 * VARIANT D is a fragment of a longer story and must be performed as one: angry and incredulous,
 * not devastated; the friend dry and immediate. It is longer than the others, so it asks for more
 * listening time before it will start and is weighted below them so it never becomes the bus stop.
 */
export const BUS_STOP_CONVERSATION: MicroSceneDefinition = {
  id: 'bus-stop-conversation',
  title: 'Parada de colectivo',
  description: 'Three people waiting under a shelter, talking about the bus, the power cuts, or a boyfriend.',
  category: 'civilian',
  tags: ['civilian', 'everyday', 'transit', 'gossip', 'propaganda'],

  compatibleAnchorTypes: ['bus-stop'],
  requiredAnchorTags: ['bus-stop'],
  weight: 10,
  cooldownSeconds: 150,

  spawnDistance: 170,
  activationDistance: 95,
  dialogueDistance: 42,
  despawnDistance: 210,

  actors: [
    {
      id: 'vigia',
      slot: 0,
      offset: { x: -1.6, z: 0.2, heading: 0 },
      cast: 'civilian-m',
      voice: 'npc-masculino-1',
      act: 'stand',
      behaviors: ['idleConversation', 'alternateSpeakerGestures', 'lookAtPassingVehicle', 'stepAwayFromRoad'],
      seed: 4021,
    },
    {
      id: 'pasajero',
      slot: 1,
      offset: { x: 0.9, z: 1.15, heading: -0.4 },
      cast: 'civilian-m',
      voice: 'npc-masculino-2',
      act: 'stand',
      seated: true,
      behaviors: ['idleConversation', 'alternateSpeakerGestures'],
      seed: 771,
    },
    {
      id: 'celular',
      slot: 2,
      offset: { x: 2.3, z: 0.35, heading: 0.25 },
      cast: 'civilian-f',
      voice: 'npc-femenina-1',
      act: 'phone',
      behaviors: ['idleConversation', 'alternateSpeakerGestures', 'lookAtPassingVehicle'],
      seed: 5310,
    },
    {
      id: 'amiga',
      slot: 1,
      offset: { x: 0.9, z: 1.15, heading: -0.35 },
      cast: 'civilian-f',
      voice: 'npc-femenina-2',
      act: 'stand',
      seated: true,
      alternate: true,
      behaviors: ['idleConversation', 'alternateSpeakerGestures'],
      seed: 6644,
    },
  ],

  props: [
    {
      id: 'board',
      kind: 'display-board',
      slot: 0,
      offset: { x: -2.9, y: 2.15, z: 1.05, heading: 0 },
      color: 0x0b1420,
      emissive: 0xffb020,
      text: 'PRÓXIMO SERVICIO: DEMORADO',
    },
    {
      id: 'propaganda',
      kind: 'display-board',
      slot: 1,
      offset: { x: 3.3, y: 1.65, z: 1.15, heading: 0 },
      color: 0x101c18,
      emissive: 0x39ff9a,
      text: 'RESPIRÁ LIMPIO — DENUNCIÁ LA COMBUSTIÓN',
    },
  ],

  sharedBehaviors: [],

  // Slow and desynchronised on purpose: a look down the avenue, a shift on the bench, a glance at
  // the phone. The beats only cue WHO is doing something; the blocks decide what that looks like.
  ambientSequence: [
    { id: 'scan-avenue', seconds: [3.5, 6], actor: 'vigia', behavior: 'lookAtPassingVehicle' },
    { id: 'shift-seat', seconds: [4, 7], actor: 'pasajero', behavior: 'idleConversation' },
    { id: 'check-device', seconds: [3, 5.5], actor: 'celular', behavior: 'idleConversation' },
    { id: 'lull', seconds: [2.5, 5], behavior: 'idleConversation' },
  ],

  dialogueVariants: [
    {
      id: 'missing-bus',
      label: 'El 82 pasó de largo',
      weight: 10,
      lines: [
        { speaker: 'vigia', clip: 'busstop_a_1', text: 'Che, ¿pasó el 82?' },
        {
          speaker: 'pasajero',
          clip: 'busstop_a_2',
          text: 'Pasó de largo. El molinete me leyó la deuda desde la esquina.',
        },
      ],
    },
    {
      id: 'power-outage',
      label: 'Cortan la luz en el Bajo',
      weight: 10,
      lines: [
        { speaker: 'vigia', clip: 'busstop_b_1', text: 'Dicen que hoy cortan la luz en todo el Bajo.' },
        { speaker: 'pasajero', clip: 'busstop_b_2', text: 'Mejor. Por ahí se apagan también las cámaras.' },
      ],
    },
    {
      id: 'combustion-car',
      label: 'Todavía queda uno a nafta',
      weight: 8,
      // Only worth saying about a car they can actually hear coming.
      conditions: [{ kind: 'playerCombustionCar' }, { kind: 'approachSlowerThan', speed: 28 }],
      lines: [
        {
          speaker: 'vigia',
          clip: 'busstop_c_1',
          text: 'Escuchá eso… todavía queda uno a nafta.',
          direction: '[quiet, impressed]',
        },
        {
          speaker: 'pasajero',
          clip: 'busstop_c_2',
          text: 'Bajá la voz, que los drones también escuchan.',
          direction: '[low, wary]',
        },
      ],
    },
    {
      id: 'cheating-boyfriend',
      label: 'El novio chanta',
      // Below the transit variants on purpose: it is the long one, and it must stay the exception.
      weight: 5,
      // Four lines and a story to follow: not worth starting unless most of it will be heard.
      minListenSeconds: 9,
      present: ['vigia', 'celular', 'amiga'],
      lines: [
        {
          speaker: 'celular',
          clip: 'busstop_d_1',
          text: '¿Sabés cómo me enteré? Me prestó el celu para pedir el bondi y le saltó: “Anoche la pasé hermoso”.',
          direction: '[angry, incredulous]',
          gapAfter: 0.3,
        },
        { speaker: 'amiga', clip: 'busstop_d_2', text: 'No… qué hijo de puta.', direction: '[flat disbelief]', gapAfter: 0.35 },
        {
          speaker: 'celular',
          clip: 'busstop_d_3',
          text: 'Y el forro me juraba que era un mensaje viejo.',
          direction: '[angry, incredulous]',
          gapAfter: 0.25,
        },
        { speaker: 'amiga', clip: 'busstop_d_4', text: 'Sí, de anoche.', direction: '[dry, immediate]' },
      ],
    },
  ],

  reactions: [
    {
      id: 'toretto',
      trigger: 'aggressivePass',
      priority: 2,
      seconds: 3.2,
      behaviors: ['lookAtPlayer', 'stepAwayFromRoad'],
      lines: [
        {
          speaker: 'vigia',
          clip: 'busstop_react_toretto',
          text: 'Dale, Toretto, pasá tranquilo.',
          direction: '[raised, unimpressed]',
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
    maxActors: 3,
    maxAnimatedActors: 3,
    maxParticles: 0,
    allowsDynamicLights: false,
    allowsPhysics: false,
  },

  status: 'needs-audio',
};
