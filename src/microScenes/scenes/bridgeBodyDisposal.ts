import type { MicroSceneDefinition } from '../types';

/**
 * SOMETHING WRAPPED IN A TARP, BEING MOVED. The rare one, and the only one that is not funny.
 *
 * WHAT IT IS NOT, and this is the whole design: there is no blood, no gore, no body part, no
 * injury and nothing graphic. The bundle is a wrapped shape on a lightweight animated prop — no
 * ragdoll, no physics — and it stays ambiguous on purpose. The player should drive away unsure
 * what they saw, which is a different and better feeling than being shown.
 *
 * The player cannot touch it, cannot start anything with it, and cannot make it into a mission.
 * Sit and watch and the two of them stop, one turns, and they tell you to keep going; keep
 * watching and the bundle goes behind the van. That is the entire interaction.
 *
 * RARE ON PURPOSE: a tenth of a civilian scene's weight, one at a time, a long cooldown, never in
 * the first minutes of a session, never near the smoke circle, never during a chase or a mission.
 */
export const BRIDGE_BODY_DISPOSAL: MicroSceneDefinition = {
  id: 'bridge-suspicious-body-disposal',
  title: 'Algo envuelto en una lona',
  description: 'Two men dragging a wrapped bundle behind a van under the bridge. Never confirmed, never interactive.',
  category: 'criminal',
  tags: ['criminal', 'suspicious', 'bridge', 'rare', 'police-reactive'],

  compatibleAnchorTypes: ['under-bridge', 'under-highway', 'industrial-alley', 'dark-service-road'],
  requiredAnchorTags: ['dark'],
  forbiddenAnchorTags: ['bus-stop', 'commercial'],
  // A tenth of the everyday scenes. It should be a thing that happened once, not a fixture.
  weight: 1,
  cooldownSeconds: 1200,

  spawnDistance: 150,
  activationDistance: 85,
  dialogueDistance: 30,
  despawnDistance: 190,

  conditions: [
    // Not in the first few minutes of a session: the city has to be ordinary first.
    { kind: 'sessionAfter', seconds: 420 },
    { kind: 'noPursuit' },
    { kind: 'noActivity' },
    { kind: 'timeOfDay', phases: ['dusk', 'night'] },
  ],

  unique: true,
  keepAwayFrom: [{ sceneId: 'bridge-smoke-circle', metres: 250 }],

  actors: [
    {
      id: 'grande',
      slot: 0,
      offset: { x: -0.85, z: -0.35, heading: 1.2 },
      cast: 'worker',
      voice: 'npc-masculino-1',
      act: 'stand',
      behaviors: ['dragLargeProp', 'watchForPolice', 'pauseWhenObserved', 'lookAtPlayer', 'resumeAfterDelay'],
      seed: 5507,
    },
    {
      id: 'flaco',
      slot: 1,
      offset: { x: 0.85, z: 0.35, heading: -1.9 },
      cast: 'worker',
      voice: 'npc-masculino-2',
      act: 'stand',
      behaviors: ['dragLargeProp', 'watchForPolice', 'pauseWhenObserved', 'lookAtPlayer', 'resumeAfterDelay'],
      seed: 6618,
    },
  ],

  props: [
    { id: 'camioneta', kind: 'van', slot: 0, offset: { x: 3.4, z: -0.4, heading: 1.5707963267948966 }, color: 0x4a4b46 },
    // A wrapped shape. Dragged by the sequence, never simulated, never interactive.
    { id: 'bulto', kind: 'bundle', slot: -1, offset: { x: 0, y: 0.22, z: 0, heading: 0.35 }, color: 0x5a5c52, dragged: true },
  ],

  sharedBehaviors: [],

  /**
   * Both ends, a short haul, an argument, a look down the road, a regrip, and on towards the back
   * of the van. It never completes into anything: the loop takes it a metre or two and starts again.
   */
  ambientSequence: [
    { id: 'take-the-ends', seconds: [2, 3], behavior: 'dragLargeProp' },
    { id: 'haul', seconds: [2.5, 4], prop: 'bulto', behavior: 'dragLargeProp', to: 'camioneta' },
    { id: 'argue', seconds: [3, 5], actor: 'flaco', behavior: 'idleConversation' },
    { id: 'check-the-road', seconds: [2, 3.5], actor: 'grande', behavior: 'watchForPolice' },
    { id: 'regrip', seconds: [1.5, 2.5], behavior: 'dragLargeProp' },
  ],

  dialogueVariants: [
    {
      id: 'bigger-tarp',
      label: 'Te dije que trajeras una lona más grande',
      weight: 10,
      lines: [
        { speaker: 'grande', clip: 'disposal_a_1', text: 'Te dije que trajeras una lona más grande.', direction: '[low, irritated]' },
        { speaker: 'flaco', clip: 'disposal_a_2', text: 'Y yo te dije que no iba a ser tan alto.', direction: '[low]' },
        { speaker: 'grande', clip: 'disposal_a_3', text: 'Bueno, levantá de tu lado.', direction: '[low]' },
      ],
    },
    {
      id: 'no-cameras',
      label: '¿Seguro que acá no hay cámaras?',
      weight: 10,
      lines: [
        { speaker: 'flaco', clip: 'disposal_b_1', text: '¿Seguro que acá no hay cámaras?', direction: '[low]' },
        { speaker: 'grande', clip: 'disposal_b_2', text: 'Seguro no estoy de nada. Movete.', direction: '[low, clipped]' },
        { speaker: 'flaco', clip: 'disposal_b_3', text: 'Me encanta laburar con profesionales.', direction: '[low, dry]' },
      ],
    },
    {
      id: 'the-keys',
      label: '¿Y las llaves de la camioneta?',
      weight: 10,
      lines: [
        { speaker: 'grande', clip: 'disposal_c_1', text: '¿Y las llaves de la camioneta?', direction: '[low]' },
        { speaker: 'flaco', clip: 'disposal_c_2', text: 'Las tenías vos.', direction: '[low]' },
        { speaker: 'grande', clip: 'disposal_c_3', text: 'Dejalo ahí un segundo.', direction: '[low]' },
        { speaker: 'flaco', clip: 'disposal_c_4', text: 'Ni en pedo lo dejo ahí.', direction: '[low, flat]' },
      ],
    },
  ],

  reactions: [
    {
      id: 'keep-driving',
      trigger: 'observed',
      priority: 5,
      seconds: 6,
      behaviors: ['pauseWhenObserved', 'lookAtPlayer'],
      lines: [{ speaker: 'grande', clip: 'disposal_react_observed', text: 'Seguí de largo.', direction: '[flat, low]' }],
    },
    {
      id: 'behind-the-van',
      trigger: 'policeNear',
      priority: 6,
      seconds: 8,
      // Nothing picks up while they are still about: the delay is long and the director holds it
      // open while a police car remains inside the scene's police radius.
      resumeAfter: [8, 14],
      behaviors: ['dragLargeProp', 'watchForPolice', 'resumeAfterDelay'],
      once: false,
    },
  ],

  interruptionPolicy: {
    onPriorityAudio: 'cancel',
    onPlayerLeaves: 'cancel',
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
