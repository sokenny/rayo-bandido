-- Loco Mustang's workshop (`docs/GARAGE_PLAN.md`): what the player's car wears and what they
-- have bought. `rb.garage` in `src/core/progress.ts`, sanitized by `sanitizeGarage` in
-- `server/accounts.mjs`.
--
-- Its own table rather than columns on `player_state`: no row still means "never synced" there,
-- and a garage saved on its own must not create a wallet of 0 beside it.
--
-- `loadout` is the compact code of `encodeLoadout` (`src/core/loadout.ts`): one line of
-- `|`-separated ids and small numbers, led by its format version (`L1|...`). The server checks
-- its shape, not its meaning — the catalogue lives in the client, which decodes it through
-- `sanitizeLoadout` whatever it says. `owned` is a JSON array of part ids (`hood.carbon-vent`).
create table player_garage (
  user_id     uuid primary key references users(id) on delete cascade,
  loadout     text not null check (char_length(loadout) <= 1024),
  owned       jsonb not null default '[]',
  updated_at  timestamptz not null default now()
);
