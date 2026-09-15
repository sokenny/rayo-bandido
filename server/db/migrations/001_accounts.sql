-- Accounts, saved progress and high scores (`server/accounts.mjs`, `server/scores.mjs`).
--
-- A player is a `users` row from their first visit: a guest has no identity rows, and signing
-- in with Google or Discord attaches one. Nothing below cares which kind of user it is holding.

create table users (
  id            uuid primary key default gen_random_uuid(),
  -- NULL until the player picks one (the lobby) or signs in with a provider that has one.
  -- Boards show 'BANDIDO' for NULL. Same limit as NAME_MAX in `src/net/protocol.ts`.
  display_name  text check (char_length(display_name) between 1 and 14),
  avatar_url    text,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);

-- One row per social login attached to a user. A user can hold several (Google and Discord).
create table user_identities (
  provider          text not null,   -- 'google' | 'discord'
  provider_user_id  text not null,   -- the provider's stable id, never the email
  user_id           uuid not null references users(id) on delete cascade,
  email             text,            -- as the provider reported it; informational only
  created_at        timestamptz not null default now(),
  primary key (provider, provider_user_id)
);
create index user_identities_user_idx on user_identities (user_id);

-- Cookie sessions. The cookie carries a random token; only its SHA-256 is stored here.
create table sessions (
  id            text primary key,
  user_id       uuid not null references users(id) on delete cascade,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  expires_at    timestamptz not null
);
create index sessions_user_idx on sessions (user_id);

-- Everything about a player that is one value: money, the intro, the passenger rides.
-- No row means "never synced", which is what lets a browser's older local record win once.
create table player_state (
  user_id          uuid primary key references users(id) on delete cascade,
  money            integer not null default 0 check (money >= 0),
  intro_status     text check (intro_status in ('completed', 'skipped')),
  intro_version    integer,
  rides_completed  integer not null default 0 check (rides_completed >= 0),
  rides_best_tip   integer not null default 0 check (rides_best_tip >= 0),
  updated_at       timestamptz not null default now()
);

-- The mission chains in `src/core/progress.ts`: how far through each one, and the best on each
-- level (score for rush, seconds for circuit, placement for street; -1 = never run).
create table mission_progress (
  user_id     uuid not null references users(id) on delete cascade,
  chain       text not null check (chain in ('rush', 'circuit', 'street')),
  cleared     integer not null default 0 check (cleared >= 0),
  best        jsonb not null default '[]',
  updated_at  timestamptz not null default now(),
  primary key (user_id, chain)
);

-- Every run submitted to a board. Only ever inserted.
create table runs (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references users(id) on delete cascade,
  board       text not null,          -- 'rush' | 'circuit' | 'street' (see BOARDS in server/scores.mjs)
  value       integer not null,       -- points, or milliseconds; the board says which way wins
  stats       jsonb not null default '{}',
  ranked      boolean not null default false,  -- spent one of the day's ranked attempts
  created_at  timestamptz not null default now()
);
create index runs_user_board_idx on runs (user_id, board, created_at desc);

-- Each player's best on each board. The leaderboards are read from here.
create table personal_bests (
  user_id      uuid not null references users(id) on delete cascade,
  board        text not null,
  value        integer not null,
  run_id       bigint not null references runs(id) on delete cascade,
  achieved_at  timestamptz not null,
  primary key (user_id, board)
);
create index personal_bests_board_idx on personal_bests (board, value);
