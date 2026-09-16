-- There are no ranked runs any more: every run counts, and the board keeps each player's best
-- (`server/scores.mjs`). The flag that marked a run as having spent a daily attempt goes with them.
alter table runs drop column ranked;
