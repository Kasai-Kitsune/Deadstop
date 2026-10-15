# FPS (working title)

Deadstop 3D FPS: CS2-style tactical rounds with MW-style kits.

## Run

    cd game
    bun serve.js

Then open http://localhost:4173

## Layout

- `game/sim/`: engine-agnostic simulation (movement, weapons, hitscan, collision)
- `game/client/`: Three.js client, HUD, debug overlay
- `game/maps/`: map definitions
- `game/config.js`: every tunable value
- `upload/fps-design-spec.md`: design spec
- `worklog.md`: development log
- `game/assets/`: meshes
