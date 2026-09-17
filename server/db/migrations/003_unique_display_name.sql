-- A display name is a player's handle: one player per name, compared without case
-- (`server/accounts.mjs` stores them upper case anyway; the index does not rely on it).

-- 'BANDIDO' is what the boards show for "no name" (and what an empty lobby name falls back to),
-- so it is nobody's.
update users set display_name = null where upper(display_name) = 'BANDIDO';

-- Names already shared by several players: a signed-in player keeps it over a guest, and the
-- older account over the newer. The rest go back to no name and can pick one.
with ranked as (
  select u.id,
         row_number() over (
           partition by upper(u.display_name)
           order by exists (select 1 from user_identities i where i.user_id = u.id) desc, u.created_at, u.id
         ) as n
    from users u
   where u.display_name is not null
)
update users set display_name = null from ranked where users.id = ranked.id and ranked.n > 1;

create unique index users_display_name_key on users (upper(display_name));
