Base: GlobeHoppers v5.0.5
Update: v5.1 routing network foundation
Changes:
- Added a first-pass water-node routing graph for boats.
- Boat routes now use A* over water gateway nodes before falling back to curve generation.
- Boat graph edges are rejected when they cross Natural Earth land polygons.
- Added many gateway/passages for Pacific coast, Panama, Caribbean channels, Atlantic, Gibraltar, Mediterranean, Suez, Red Sea, Indian Ocean, Europe channels, and broad global corridors.
- Long ocean routes now route through a valid water network rather than one-off hard-coded curves.
- Surface car/train routes now validate that generated paths mostly stay on land.
- Car/train Natural Earth-guided paths are rejected if they leave land too much, then replaced with a conservative land-biased fallback.
- Existing manual route overrides still take priority.
