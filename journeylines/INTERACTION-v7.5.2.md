# GlobeHoppers v7.5.2 Interaction Notes

## Playback camera ownership

Playback owns the map camera whenever a Hop is advancing. Any delayed View Globe, idle, restore, or auto-level completion callback must verify the current playback context before applying a camera update. Manual map interaction remains available during playback. After release, the return sequence keeps the camera outside the globe, finishes orientation before the final zoom-in, and targets the vessel's current position.

## Surface presentation

Road, rail, and water provider geometry remains the route source of truth. The active presentation route is prepared once before playback. Boats use fewer broad offshore anchors and stronger corner softening in open water; high-turn anchors remain available for channels and constrained approaches. No route shaping occurs per animation frame.

## Timeline

Timeline zoom is horizontal only. The viewport height, marker rail, and label rail remain constant. At close zoom, month labels replace the year labels in the same reserved row. January labels include the year to preserve calendar context.

## Shared result cards

Destination selection and Timeline search use the same component. The left column contains the Hop title and optional Hopper name. The right column contains the origin-to-destination route at the top and the date at the bottom.

## Globe visibility

Placards, vehicles, and decorative flight arcs are conservative near the globe limb. A coordinate must be on the visible side according to both the map target and the visual screen center, and its projected point must remain inside the visible globe disk. Route lines crossing the antimeridian are emitted as separate line segments.
