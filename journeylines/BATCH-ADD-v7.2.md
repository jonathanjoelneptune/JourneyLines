# GlobeHoppers v7.2 Batch Add Hops

## Workflow

1. Open **Add Hop** and select **Batch Add Hops**.
2. Complete the streamlined Hop form. Hop Preview is intentionally omitted.
3. Select **Done with Hop**. Surface routes are generated and validated before the Hop enters the staged table.
4. Select **Add Another Hop** to reset the editor for another entry.
5. Use the explicit **Edit** or **Delete** controls on a staged row.
6. Select **Save Batch** to apply all staged Hops in one in-memory update and one queued repository transaction.

## Staged table

Rows are sorted chronologically. Equal-date rows retain entry order. Each row includes title, year, month, dates, Hopper, date-derived home-base start, all destination legs and vessels in one multiline cell, trail type, and actions.

## Unsaved changes

Switching staged rows, adding another Hop, saving the batch, or closing Batch Add prompts when the upper editor has unstaged changes. The prompt supports saving the current Hop to the batch, discarding the editor changes, or cancelling the action.

## Data and routing integrity

- Each staged Hop is normalized against repository trips plus the other staged Hops.
- The start location is derived from the active home base for the Hop date unless the user explicitly overrides it.
- New locations are retained per staged row and merged only when the batch is saved.
- Deleting a staged row also removes its uncommitted location additions from the final batch payload.
- Surface route calculation occurs at staging time and is repeated by repository route preparation only when geometry is missing or stale.
- Final repository persistence uses the existing atomic Git data update for trips, locations, and route details.
