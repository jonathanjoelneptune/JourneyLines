Base: GlobeHoppers v5.1.7
Update: v5.1.8 major water corridor node spine
Changes:
- Added 25 major water corridors as reusable database nodes in naturalEarthRouting.json.
- Corridors include Panama, Gibraltar, Suez, English Channel, North Sea, Irish Sea, Caribbean north/south, Bahamas/Florida Straits, Yucatan Channel, Gulf of Mexico, Baja Pacific, Gulf of California, U.S. East Coast, U.S./Canada Pacific Coast, Transatlantic, Mediterranean west/central, Aegean, Adriatic, Bosporus/Dardanelles, Red Sea, Bab el-Mandeb, Hormuz/Persian Gulf, and Malacca.
- Added waterGraphNodes and waterGraphEdges to the routing database so future routes can use a shared global water-pathway spine.
- Boat graph now loads water corridor nodes from naturalEarthRouting.json instead of relying only on hard-coded in-component nodes.
- Increased long-route graph neighbor budget slightly so routes can traverse the richer corridor network.
- This is a foundation for complex multi-continent boat routes and future refinement of each corridor.
