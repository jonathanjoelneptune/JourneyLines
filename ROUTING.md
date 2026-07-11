Base: GlobeHoppers v5.1.2
Update: v5.1.3 forced long-water corridor repackage
Changes:
- Added a forced west North America ↔ Mediterranean water corridor before the generic graph route.
- The forced corridor gives Baja, Panama, Hispaniola/Caribbean islands, North Africa, and Athens a wider water berth.
- Panama now uses explicit wide approach -> west canal approach -> short canal leg -> Caribbean exit nodes.
- Caribbean corridor now passes south of Hispaniola instead of allowing graph/smoothing shortcuts across it.
- Mediterranean corridor stays mid-water/north of North Africa and approaches Athens from the Aegean/Piraeus water side.
- Generic graph routes are now validated against land and island no-cross boxes before being accepted.
- Repackaged so this correction is definitely included in the ZIP.
