# VTD Dashboard Handoff

## What This Project Is

This is a HubSpot-backed `VTD Dashboard` built as a shareable web app.

It was created to report:

- `VTD Booked`
- `VTD Completed`
- `Booking Confirmations`
- `Cancelled / Returned`
- `BC Conversion`

The frontend is a React/Vite app styled to match the provided `vtd_dashboard.html` layout.

The backend logic is server-side and reads directly from HubSpot using a private app token. The token is not exposed to the browser.

## Important Live URLs

- Public dashboard: [https://vtd-dashboard.vercel.app](https://vtd-dashboard.vercel.app)
- Local app during dev: [http://127.0.0.1:4173/](http://127.0.0.1:4173/)
- Vercel project: `vtd-dashboard`

## Important Local Files

- Main frontend: [src/App.tsx](/Users/a38651/Documents/Codex/2026-05-26/okay-i-need-a-view-now/src/App.tsx)
- Main styles: [src/App.css](/Users/a38651/Documents/Codex/2026-05-26/okay-i-need-a-view-now/src/App.css)
- Shared types: [src/types.ts](/Users/a38651/Documents/Codex/2026-05-26/okay-i-need-a-view-now/src/types.ts)
- HubSpot data logic: [hubspot/dashboard.js](/Users/a38651/Documents/Codex/2026-05-26/okay-i-need-a-view-now/hubspot/dashboard.js)
- Serverless API route: [api/dashboard.js](/Users/a38651/Documents/Codex/2026-05-26/okay-i-need-a-view-now/api/dashboard.js)
- Vercel config: [vercel.json](/Users/a38651/Documents/Codex/2026-05-26/okay-i-need-a-view-now/vercel.json)
- Setup notes: [README.md](/Users/a38651/Documents/Codex/2026-05-26/okay-i-need-a-view-now/README.md)
- Original provided HTML reference: [vtd_dashboard.html](</Users/a38651/Downloads/files1/vtd_dashboard.html>)

## Core Dashboard Logic

### Counts

- `VTD Booked`
  - Unique associated contacts on deals where `virtual_test_drive_status` is `BOOKED` or `COMPLETED`

- `VTD Completed`
  - Booked contacts where either:
    - deal `test_drive_status` indicates done/completed
    - or contact `check_in_walk_in_date` exists

- `Booking Confirmations`
  - Filtered booked contacts with at least one associated deal where `booking_confirm_date` exists

- `Cancelled / Returned`
  - Rows where deal `cancelled___return_date` exists

- `BC Conversion`
  - `BCs / Completed * 100`

### Inferred Interstate

- `Yes` when `delivery_state != vehicle state`
- `No` when they match
- `Unknown` when either side is missing

## Filters

Current filters in the app:

- `Booked By`
- `Date From`
- `Date To`
- `Vehicle State`
- `User State`
- `Interstate`
- `Inferred Interstate`

### Date Anchor

Current date filtering is anchored to:

- deal `td_booking_slot_date`

There was an open data-quality question here:

- Some deals appear on `2026-05-17`
- User expectation was that bookings should start from `2026-05-18`
- We verified HubSpot itself currently has `td_booking_slot_date = 2026-05-17` for several deals
- So the dashboard is reflecting HubSpot’s stored value, not inventing it

If needed in a future chat, revisit whether date filtering should instead use:

- `virtual_test_drive_status_timestamp`
- or `createdate`
- instead of `td_booking_slot_date`

## Current HubSpot Property Mapping

### Deal Properties

- `order_id`
- `car_location_at_time_of_sale`
- `virtual_test_drive_status`
- `virtual_test_drive_booked_by`
- `test_drive_status`
- `booking_confirm_date`
- `cancelled___return_date`
- `delivery_state`
- `interstate_sale_yesno`
- `td_booking_slot_date`

### Contact Properties

- `email`
- `check_in_walk_in_date`
- `state`

Note:

- Vehicle State should now come from deal `car_location_at_time_of_sale`
- User State is using deal `delivery_state`

## Known Exclusions

The backend excludes:

- emails containing `cars24`
- emails containing `yopmail`
- exact email `ss@mm.com`
- exact order ID `WL46WF`

This was added because `WL46WF / ss@mm.com` was confirmed to be test data.

## Specific Debugging Findings From This Chat

### Deal `TSET31`

We investigated why it was showing the wrong vehicle state.

What was found:

- Deal `order_id`: `TSET31`
- Deal `car_location_at_time_of_sale`: `VIC`
- Deal `delivery_state`: `QLD`
- Contact `vehicle_state`: `QLD`

Root cause:

- Earlier version of the dashboard used contact `vehicle_state`
- This caused `QLD` to show instead of the correct deal-side `VIC`

Fix applied:

- Vehicle State now comes from deal `car_location_at_time_of_sale`

### Deal `OU34GT`

This deal came up in date debugging because its `td_booking_slot_date` is `2026-05-17`.

It is associated with:

- `test20may3@yopmail.com`

Important note:

- It should be excluded from the dashboard because of the `yopmail` rule
- It only appeared during direct HubSpot debugging queries, not in the filtered dashboard output

## Reliability / Error Handling

HubSpot sometimes returned upstream `502/503/504` errors through Cloudflare.

A retry/backoff layer was added in [hubspot/dashboard.js](/Users/a38651/Documents/Codex/2026-05-26/okay-i-need-a-view-now/hubspot/dashboard.js) for:

- `429`
- `502`
- `503`
- `504`

Behavior now:

- transient errors retry automatically
- if HubSpot is still down, the app returns a short clean error instead of dumping the full Cloudflare HTML page

## Deployment Notes

The project was deployed to Vercel.

Key deployment/history notes:

- Vercel project was renamed from `okay-i-need-a-view-now` to `vtd-dashboard`
- The public alias `vtd-dashboard.vercel.app` needed to be manually repointed more than once because it stayed on older deployments
- If something looks stale in the future, verify alias mapping with Vercel CLI

Relevant local Vercel metadata:

- [.vercel/project.json](/Users/a38651/Documents/Codex/2026-05-26/okay-i-need-a-view-now/.vercel/project.json)

## Current User Expectations / Preferences

- Vehicle state must come from the deal, not the contact
- User state means delivery state
- Inferred interstate should compare delivery state vs vehicle state
- Test data must be removed
- Frontend should follow the provided HTML look-and-feel
- Token must remain secured server-side

## Suggested Fresh-Chat Prompt

Use this in a new chat:

```text
Continue work on the VTD Dashboard in /Users/a38651/Documents/Codex/2026-05-26/okay-i-need-a-view-now.

Read /Users/a38651/Documents/Codex/2026-05-26/okay-i-need-a-view-now/CHAT_HANDOFF.md first.

Important current rules:
- vehicle state must come from deal car_location_at_time_of_sale
- user state means deal delivery_state
- inferred interstate = delivery_state != vehicle_state
- exclude cars24, yopmail, ss@mm.com, and order WL46WF
- token stays server-side

Public URL:
- https://vtd-dashboard.vercel.app
```

## Last Known State

At the end of this chat:

- `WL46WF / ss@mm.com` was removed
- `TSET31` showed `vehicleState: VIC`
- date filtering was using `td_booking_slot_date`
- cancelled/returned metric was present at the top
- public URL alias had been repointed to the latest deployment

