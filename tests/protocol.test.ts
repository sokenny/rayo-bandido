import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  C2S,
  EMPTY_ROOM_TTL_MS,
  MAX_PLAYERS,
  MAX_ROOMS,
  NAME_MAX,
  PROTOCOL_VERSION,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LEN,
  ROOM_LABEL_MAX,
  S2C,
  SNAPSHOT_HZ,
  TRAFFIC_HZ,
  sanitizeName,
  sanitizeRoomCode,
  sanitizeRoomLabel,
} from '../src/net/protocol';

/**
 * The client's protocol module and the server's are two copies of one contract: the server
 * runs plain JavaScript under Node and cannot import the TypeScript one. This test is what
 * stops the copies drifting — it reads `server/protocol.mjs` as text and checks that every
 * message name and every shared constant matches the source of truth in `src/net/protocol.ts`.
 *
 * Reading the file rather than importing it is deliberate: `server/` is outside the compiled
 * project on purpose, and a test that reaches into it as data does not drag it back in.
 */

const serverSource = readFileSync(fileURLToPath(new URL('../server/protocol.mjs', import.meta.url)), 'utf8');

/** Pull `export const NAME = { key: 'value', ... }` out of the server module as a plain map. */
function messageMap(name: string): Record<string, string> {
  const block = new RegExp(`export const ${name} = \\{([\\s\\S]*?)\\n\\};`).exec(serverSource);
  if (!block) throw new Error(`server/protocol.mjs has no ${name} block`);
  const out: Record<string, string> = {};
  const entry = /^\s*(\w+):\s*'([^']*)',/gm;
  let match: RegExpExecArray | null;
  while ((match = entry.exec(block[1])) !== null) out[match[1]] = match[2];
  return out;
}

/** Pull `export const NAME = 123;` out of the server module. */
function constant(name: string): number {
  const match = new RegExp(`export const ${name} = (\\d+);`).exec(serverSource);
  if (!match) throw new Error(`server/protocol.mjs has no ${name}`);
  return Number(match[1]);
}

/** Pull `export const NAME = 'abc';` out of the server module. */
function text(name: string): string {
  const match = new RegExp(`export const ${name} = '([^']*)';`).exec(serverSource);
  if (!match) throw new Error(`server/protocol.mjs has no ${name}`);
  return match[1];
}

describe('wire protocol', () => {
  it('names the same client-to-server messages on both sides', () => {
    expect(messageMap('C2S')).toEqual({ ...C2S });
  });

  it('names the same server-to-client messages on both sides', () => {
    expect(messageMap('S2C')).toEqual({ ...S2C });
  });

  it('agrees on the shared constants', () => {
    expect(constant('PROTOCOL_VERSION')).toBe(PROTOCOL_VERSION);
    expect(constant('MAX_PLAYERS')).toBe(MAX_PLAYERS);
    expect(constant('SNAPSHOT_HZ')).toBe(SNAPSHOT_HZ);
    expect(constant('TRAFFIC_HZ')).toBe(TRAFFIC_HZ);
    expect(constant('NAME_MAX')).toBe(NAME_MAX);
  });

  it('agrees on the room constants', () => {
    expect(constant('ROOM_CODE_LEN')).toBe(ROOM_CODE_LEN);
    expect(constant('ROOM_LABEL_MAX')).toBe(ROOM_LABEL_MAX);
    expect(constant('MAX_ROOMS')).toBe(MAX_ROOMS);
    expect(constant('EMPTY_ROOM_TTL_MS')).toBe(EMPTY_ROOM_TTL_MS);
    // A code typed against one alphabet and read against another would refuse legal rooms.
    expect(text('ROOM_CODE_ALPHABET')).toBe(ROOM_CODE_ALPHABET);
  });

  it('uses each message name exactly once per direction', () => {
    const values = [...Object.values(C2S)];
    expect(new Set(values).size).toBe(values.length);
    const replies = [...Object.values(S2C)];
    expect(new Set(replies).size).toBe(replies.length);
  });
});

describe('name sanitising', () => {
  it('trims, collapses whitespace and caps the length', () => {
    expect(sanitizeName('  juan   chaher  ')).toBe('juan chaher');
    expect(sanitizeName('x'.repeat(40))).toHaveLength(NAME_MAX);
  });

  it('falls back when the name is empty or only whitespace', () => {
    expect(sanitizeName('')).toBe('BANDIDO');
    expect(sanitizeName('   ')).toBe('BANDIDO');
    expect(sanitizeName('', 'GHOST')).toBe('GHOST');
  });
});

describe('room codes', () => {
  it('takes a code however it was typed, pasted or capitalised', () => {
    expect(sanitizeRoomCode('k7qp')).toBe('K7QP');
    expect(sanitizeRoomCode(' K7-QP ')).toBe('K7QP');
    // A whole share link pasted into the code field still yields the code.
    expect(sanitizeRoomCode('K7QPXY')).toBe('K7QP');
  });

  it('refuses anything that is not a full code, so a half-typed one never connects', () => {
    expect(sanitizeRoomCode('K7Q')).toBe('');
    expect(sanitizeRoomCode('')).toBe('');
    // I, O, 0 and 1 are not in the alphabet: they are what people mistype codes as.
    expect(sanitizeRoomCode('IO01')).toBe('');
  });

  it('never mints a code containing a character it would then refuse', () => {
    for (const char of ROOM_CODE_ALPHABET) expect(sanitizeRoomCode(char.repeat(ROOM_CODE_LEN))).toHaveLength(ROOM_CODE_LEN);
  });
});

describe('room labels', () => {
  it('trims, collapses whitespace and caps the length', () => {
    expect(sanitizeRoomLabel('  juan   room  ')).toBe('juan room');
    expect(sanitizeRoomLabel('x'.repeat(80))).toHaveLength(ROOM_LABEL_MAX);
  });

  it('falls back when the label is empty', () => {
    expect(sanitizeRoomLabel('   ')).toBe('BANDIDO ROOM');
    expect(sanitizeRoomLabel('', 'GHOST ROOM')).toBe('GHOST ROOM');
  });
});
