Base: GlobeHoppers v4.31.4
Update: v4.32 save UX performance
Changes:
- Add/Edit Hop now validates and updates local app state, then closes the modal immediately.
- GitHub repository save continues in the background after the modal closes.
- Repository save status appears in the timeline ... menu.
- If GitHub save fails, the app shows a popup alert and the ... menu records the failure.
- GitHub save still commits trips.json, locations.json, and routeDetails.json together.
