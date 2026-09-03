# Rayo Bandido — Fable starter kit

This bundle is intended to be placed at the root of a new repository and handed to Claude Fable 5.1 as the lead coding/orchestration agent.

## Start

1. Copy or unzip this entire bundle into an empty repository.
2. Open Claude Code in that repository.
3. Select Fable 5.1 as the lead model and allow it to delegate bounded implementation tasks to Opus 5 subagents.
4. Paste the complete contents of `PROMPT_TO_FABLE.md` as the first instruction.
5. Let the first run continue for roughly 60–90 minutes, intervening only if Fable asks for a genuinely blocking product decision.

The lead agent should leave the repository runnable after every integration checkpoint. The first goal is a playable vertical slice, not polished production code.

## Documents

- `PROMPT_TO_FABLE.md`: copy/paste prompt for the lead agent.
- `AGENTS.md`: standing rules for every agent working in the repository.
- `docs/PRODUCT_CONCEPT.md`: world, fantasy and gameplay loop.
- `docs/MVP_SPEC.md`: day-one scope and performance budget.
- `docs/VISUAL_DIRECTION.md`: approved camera and moodboard interpretation.
- `docs/DECISIONS.md`: locked decisions and temporary defaults.
- `docs/BACKLOG.md`: ordered implementation backlog.
- `docs/ACCEPTANCE_CHECKLIST.md`: objective definition of done.
- `docs/PROGRESS.md`: handoff log agents must maintain.
- `assets/ASSET_MANIFEST.md`: intended use and technical status of every supplied asset.

## Important asset warning

`assets/source/gt86-source-unoptimized.glb` is not runtime-ready. It contains approximately 3.06 million triangles in one mesh, has no separate wheels and no animations. It is included as visual source material. Do not let it block the MVP.

