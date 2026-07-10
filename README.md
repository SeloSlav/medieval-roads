# City Builder Starter Kit - ThreeJS

A real-time Three.js sandbox for drawing medieval dirt roads on a procedural 3D landscape. Build road networks across rolling hills, pine forests, and winding rivers — wooden bridges and graded ramps appear automatically when a path crosses water. Drop into first-person walk mode to explore the world on foot. Features terrain-aware road placement, junction generation, animated water, streamed grass LOD, and a contextual builder HUD for prototyping game-world paths.

![Road network with wooden bridges, ramps, and forest](docs/screenshots/medieval-roads-bridges-forest.png)

## Features

### Road building

- Interactive point-by-point road drawing projected onto a 3D terrain heightfield.
- Terrain projection so roads follow hills, slopes, and ground variation.
- Snapping to existing road nodes and road segments.
- Automatic edge splitting when new roads connect to existing segments.
- Wheel-adjusted curvature per segment (`Ctrl + scroll`).
- Junction classification for endpoints, bends, T-junctions, cross-junctions, and complex junctions.
- Junction and endpoint cap meshes that blend road ribbons into clean intersections.
- Textured medieval dirt road materials with irregular blended shoulders.
- Live road preview while drawing, plus selection and delete with confirmation popup.
- Undo last placed point, undo last committed change, and full draft cancel.
- Terrain road-wear blending that tints grass to packed dirt along committed road corridors.
- Automatic river bridge generation when a road crosses water — graded approach ramps, elevated deck, and instanced support posts.
- Wood-log bridge deck material blended onto the road ribbon via a per-vertex `bridgeBlend` attribute.
- Bridge preview tint while drawing, plus placement validation that rejects spans wider than the max bridge length.
- Rock collision checks that block roads through scattered forest and river-shore boulders.

### Exploration

- First-person walk mode with pointer-lock mouse look, spawned from the current orbit camera position.
- Terrain-following locomotion with sprint, jump, crouch toggle, and head-bob camera motion.
- Free-look while holding `Alt` — look around without turning the body; view recenters on release.
- Scrolling compass HUD with cardinal and intercardinal labels while walking.
- Seamless handoff between RTS orbit camera and walk mode via `~` (backtick).
- Walk locomotion samples road deck height so you can traverse built roads and bridges on foot.

### Landscape & environment

- Large procedural heightfield terrain with multi-layer value noise and broad macro shaping.
- TSL grass-blend terrain material mixing meadow, dense, and dry grass PBR texture sets.
- River-carved valleys with muddy shore blending where water meets land.
- Procedural river layout with multiple source corridors, tributaries, and a central confluence drain.
- Animated river water using a 2D virtual-pipes simulation with foam, shore lap, and alpha feathering.
- Organic river shore SDF fields for natural bank shapes and terrain mud tinting.
- Scatter-placed river shore stones along bank edges, with procedural shore-crossing gaps that clear stones for natural ford points.
- Instanced conifer forest with narrow, broad, and young tree forms plus scattered rocks and outcrops.
- Forest undergrowth — instanced bushes and ferns scattered in dense woodland pockets.
- Streamed 3D grass blade tufts with camera-relative LOD, zoom-gated reveal, and road clearance.
- Road-edge tree stumps placed along committed road corridors after tree clearance.
- River shore reeds clustered along bank edges for added shoreline detail.
- Trees automatically cleared along built roads; props respect river blocking zones.
- Animated volumetric-style sky and cloud dome with wind-driven motion.
- Directional sun lighting, exponential fog, soft shadow maps, and shadow bounds fitting.

### Rendering & UI

- WebGPU renderer preferred with automatic WebGL fallback.
- Dual post-processing pipeline: WebGL bloom + color grade, or WebGPU TSL bloom + daylight grade.
- Progressive loading screen with staged status labels while the world initializes.
- Contextual tip cards for camera, walk, and road modes — toggle off via the game menu.
- Game menu with persistent "turn off tips" preference stored in `localStorage`.
- Toast notifications for rejected road placements (steep slope, river too wide, rocks in the way, etc.).
- HUD with floating road/build tool buttons, live FPS and zoom readout, and compass strip.
- Responsive full-screen canvas built with Vite, TypeScript, and Three.js r185.

## Controls

| Action | Control |
| --- | --- |
| Toggle road tool | `R` or click **Roads** |
| Place point | Left-click on terrain |
| Undo last placed point while drawing | Right-click |
| Curve the road | Hold `Ctrl` and scroll the mouse wheel |
| Commit / build the road | Click the hammer icon or press `Enter` |
| Delete road segment | In road mode, hold `Alt` and left-click a segment |
| Confirm deletion | Click **Remove** in the popup |
| Undo last road change | `Ctrl+Z` / `Cmd+Z` |
| Cancel active road preview | `Escape` (road mode) |
| Pan camera | Right-click drag, `WASD`, or arrow keys |
| Rotate camera | Middle-click drag or `Q` / `E` |
| Zoom camera | Mouse wheel |
| Toggle walk mode | Backtick (`~`) |
| Move (walk mode) | `WASD` or arrow keys |
| Sprint | `Shift` |
| Jump | `Space` |
| Crouch toggle | `C` |
| Free look (walk mode) | Hold `Alt` |
| Exit walk mode | `Escape` (walk mode) |
| Open game menu | Click the menu button (top-left) |

## Quick Start

Install dependencies:

```bash
npm install
```

Run the development server:

```bash
npm run dev
```

Open the local URL printed by Vite, usually:

```text
http://localhost:5173/
```

Create a production build:

```bash
npm run build
```

Preview the production build:

```bash
npm run preview
```

## Project Structure

```text
src/
  app/        App bootstrap and frame loop
  camera/     RTS orbit camera, first-person controller, and locomotion helpers
  grass/      Streamed 3D grass blade field and zoom LOD math
  input/      Keyboard and pointer state helpers
  props/      Instanced forest, undergrowth, stumps, rocks, road clearance, shadow filters
  rivers/     River layout, field sampling, water sim, banks, reeds, and shore stones
  roads/      Road graph, drawing tool, mesh generation, junctions, bridges, materials
  scene/      Three.js scene, renderer backend, lighting, post-processing
  sky/        Animated sky/cloud mesh
  terrain/    Procedural heightfield, grass materials, road wear, ray projection
  ui/         Build toolbar, compass HUD, game menu, tip cards, toasts, loading screen
  utils/      Path geometry helpers and Three.js disposal
public/
  assets/     Terrain, road, prop, and third-party texture assets
scripts/
  derive_pbr_maps.py           Utility script for derived texture maps
  generate_wood_logs_texture.py  Procedural wood-log bridge albedo generator
docs/
  screenshots/ Project screenshots used by this README
```

## How It Works

The terrain is generated as a continuous heightfield in `src/terrain/Terrain.ts`. It combines several value-noise layers with broad sine/cosine shaping, then uses vertex colors to blend grass tints and a shore-blend attribute for muddy river banks. `TerrainGrassMaterial.ts` builds a TSL node material that samples meadow, dense, and dry PBR sets per vertex.

`RiverLayout.ts` generates procedural river corridors from map edges toward a central drain, with optional tributaries. `RiverField.ts` rasterizes those corridors into mask and signed-distance fields used for terrain carving, shore mud blending, and prop blocking. `RiverWaterMesh.ts` runs a lightweight 2D virtual-pipes water simulation each frame and drives animated foam and shore effects through `RiverWaterMaterial.ts`.

Road placement is handled by `src/roads/RoadTool.ts`. Pointer input is projected onto the terrain by `TerrainProjector`, collected as clicked road nodes with optional wheel-adjusted curvature, validated against slope and minimum length rules, and committed into a `RoadNetwork`.

`src/roads/RoadNetwork.ts` stores roads as nodes and edges. It resolves endpoint snapping, splits existing road segments when new paths connect into them, detects crossings, prunes orphan nodes, and classifies junction types.

`src/roads/RoadMeshBuilder.ts` turns road graph edges into terrain-following ribbon meshes. It samples Catmull-Rom curves, builds a core dirt ribbon, adds irregular blended shoulders, and keeps the road slightly above the terrain to avoid z-fighting. When a path crosses water, `RiverBridgeSpans.ts` detects wet runs, raises the deck above the water surface, and blends graded approach ramps; `BridgeSupports.ts` places instanced posts under the deck. `RoadJunctionBuilder.ts` adds endpoint caps and junction patch geometry at classified nodes.

`RoadPlacementValidation.ts` checks slope, minimum length, max bridge span, and rock collisions before commit. `RiverShoreCrossingGaps.ts` seeds procedural clearance zones along river banks so shore stones skip natural crossing points.

`src/props/ForestProps.ts`, `ForestUndergrowth.ts`, and `ForestManager.ts` scatter instanced conifer trees, bushes, ferns, and rocks across the playable area, skipping rivers and clearing trees near committed road edges. `RoadStumps.ts` places cut stumps along road shoulders after clearance. `RiverReeds.ts` adds instanced reed clusters along river banks.

`src/grass/GrassBladeField.ts` streams instanced 3D grass tufts in camera-relative chunks. Tufts fade in at close zoom (aligned with the terrain dirt LOD band) and are cleared near committed roads. `TerrainRoadWear.ts` updates a per-vertex `roadWearBlend` attribute so the TSL grass material tints to packed dirt along road corridors.

`src/camera/CameraController.ts` drives the RTS orbit camera with smooth pan, rotate, and zoom (displayed as a percentage in the HUD). `FirstPersonController.ts` handles walk mode — pointer-lock look, terrain- and road-deck-sampled foot placement, sprint/jump/crouch, free-look, camera bob, and compass heading publication.

`src/ui/BuildToolbar.ts` composes the HUD: tool buttons, contextual tip cards, FPS/zoom stats, compass strip, delete popup, and game menu. `ToastManager.ts` surfaces placement validation errors. `LoadingScreen.ts` shows staged progress during world bootstrap.

`src/scene/SceneManager.ts` owns the renderer backend, terrain, sky, forest, grass field, river system, road groups, selection/preview groups, lighting, fog, and post-processing. Forest and grass build asynchronously after the first frame to keep initial load responsive.

## Tech Stack

- TypeScript
- Vite
- Three.js r185 (WebGL + WebGPU)
- TSL node materials for terrain grass, road surfaces, and river water
- ACES tone mapping, soft shadows, bloom, fog, and custom daylight color grading

## Assets

Texture assets are stored under `public/assets/textures`. The road surface uses a medieval dirt texture set with albedo, normal, roughness, ambient occlusion, height, rut mask, and edge mask maps. River bridge decks use a separate wood-log PBR set (procedurally generated via `scripts/generate_wood_logs_texture.py`). Terrain uses multiple manor grass PBR sets (meadow, dense, dry, blend) and prop textures for pine foliage and rocks. Everything is loaded locally at runtime — no backend or external asset service required.

## Development Notes

- The app is client-only and can be hosted as a static build.
- `npm run build` runs TypeScript first, then Vite's production build.
- WebGPU is attempted first; if initialization fails or the browser lacks support, the app falls back to WebGL automatically.
- A Vite chunk-size warning may appear because Three.js and post-processing code are bundled into the main client chunk. The build still completes successfully.
- Forest and grass vegetation build asynchronously after the first frame to keep initial load responsive.
- `dist/`, `node_modules/`, logs, and local editor files are ignored by Git.
