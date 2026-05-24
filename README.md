# physical-thunder-sound-synthesis

Synthesize thunder from a physical lightning bolt's shape.

## Web demo (lightning viewport)

A small Three.js viewer lives in [`demo/`](demo/). It shows placeholder lightning geometry (line segments) in a pannable, zoomable 3D view.

From the repo root, serve the folder over HTTP (ES modules need a server, not `file://`):

```bash
cd demo && python3 -m http.server 8080
```

Then open [http://localhost:8080](http://localhost:8080).

## Milestones
1. The Physical Shape (lightning Geometry)
Create an L system for procedural lightning generation.

2. The Ribner and Roy Model
Create a basic sound system that sums the individual N waves of segments

3. Atmospheric Effects
Model the atmospheric effects of the sound propogation (see https://github.com/dougjam/demos/tree/master/atmospheric-absorption for reference).

4. Multi-Strike Discharges
Model multi-strike discharges instead of a single discharge.

5. The Observer (Coordinate System)
Create a system to visualize the user relative to the lightning and the shape of lightning.

6. Environmental Scattering
Additional effects for echo. See the chapter on Thunder in Andy Farnell's "Designing Sound" to see what environmental components they model.