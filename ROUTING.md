Base: GlobeHoppers v5.0.4
Update: v5.0.5 camera follow and long-route vessel corrections
Changes:
- Camera look-ahead and lead bias reduced so long trips keep the vessel on screen.
- Long boat/train trips zoom out slightly more during cruise to preserve vessel visibility.
- Trip-start camera transition slowed from 2.4s to 4.2s for gentler setup motion.
- Per-frame camera smoothing softened to reduce jerkiness.
- Added Baja peninsula surface routing for San Diego ↔ Cabo train/car style routes.
- Added more granular Pacific/Panama/Atlantic/Gibraltar/Mediterranean waypoints for west North America ↔ Mediterranean boat routes.
- Long gateway boat routes now use a low-overshoot piecewise smooth route instead of Catmull-Rom corner cutting through land.
