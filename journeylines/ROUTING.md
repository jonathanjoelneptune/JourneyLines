Base: GlobeHoppers v4.35.1
Update: v4.36 queued repository save debounce
Changes:
- Add/edit/delete still updates the local UI instantly.
- Repository saves are now queued with a short 3-second debounce.
- Multiple rapid changes are merged into one pending repository save.
- Only one GitHub commit runs at a time.
- If a save is already running, later changes wait until it finishes, then save after a short delay.
- GitHub 409 and 422 non-fast-forward reference updates are treated as retryable conflicts.
- Repository save status reports queued, saving, saved, and error states in the timeline ... menu.
