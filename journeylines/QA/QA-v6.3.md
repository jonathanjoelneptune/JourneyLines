# GlobeHoppers v6.3 QA

## Playback control states

- Confirm the main playback button reads **Play** before the journey begins.
- Start playback and confirm the button reads **Pause**.
- Pause playback and confirm the button reads **Resume**.
- Select Resume and confirm playback continues from the preserved position without restarting the active leg.
- Let the final leg finish and confirm the button reads **Complete** until Restart Journey is selected.
- Confirm the top-bar playback button exposes matching Play, Pause, Resume, and completed-state labels.

## Add/Edit Hop layout

- Open Add Hop and Edit Hop at desktop viewport widths of 1920, 1440, 1280, and 1024 CSS pixels.
- Confirm Hop Preview remains fully visible and its title circle does not intersect the card edge or scrollbar.
- Confirm route marker circles and traveler/status text remain inside every preview row.
- Add at least 17 legs and confirm the editor and preview can scroll without horizontal clipping.
- Confirm the Hop Preview scrollbar has a reserved gutter and does not overlay card content.
- Confirm the destination-entry column remains usable after the preview column is widened.
- Confirm the modal stacks to one column at 980 px and below.
- Check browser zoom at 80%, 100%, 125%, and 150% for unexpected horizontal overflow.

## Regression

- Confirm connected-leg camera handoffs retain the v6.1.1 hold/release behavior.
- Confirm timeline completion still glides outward around the final destination.
- Confirm Restart Journey remains the only control that resets to the intro/home position.
- Confirm routing-engine retry and Hopper integrity diagnostics remain available in Advanced Controls.
- Confirm Add/Edit Hop save, cancel, delete, destination autocomplete, and route preview mode controls still work.

## Packaging

- QA documents exist only under `journeylines/QA/`.
- `package-lock.json`, `journeylines/src/data/trips.json`, and `journeylines/src/data/hoppers.json` are excluded from release ZIPs.
- Both the complete-repository ZIP and updated-files-only ZIP preserve the established repository folder structure.

## Files removed from v6.2

When applying the updated-files-only package, remove these v6.2 paths so the repository exactly matches v6.3:

- `QA-v6.1.md`
- `QA-v6.2.md`
- `journeylines/QA-v6.1.md`
- `journeylines/QA-v6.2.md`
- `journeylines/dist/assets/AdminPanel-BzvOU1mE.js`
- `journeylines/dist/assets/index-BgCxkGFH.css`
- `journeylines/dist/assets/index-CTSRujCF.js`

