# GlobeHoppers v3.24

First-click camera and pause fixes:
- Edit Travel Timeline freezes the playback clock exactly where it is opened
- Closing Edit Travel Timeline resumes from that exact frozen point
- Globe button now sends an immediate map command so the first click zooms out/restores overview/spins
- Timeline and queue-card jumps now force the next route camera immediately on the first click
- Quick fade-to-black transition retained for timeline/queue jumps
- Takeoff pitch is increased again to better match landing pitch
- Travel Timeline and Studio scroll/pointer events are isolated from map playback more aggressively
- package intentionally omits src/data/trips.json and package-lock.json
