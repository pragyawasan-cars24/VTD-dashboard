# VTD to BC Dashboard

This app creates a shareable HubSpot-backed dashboard for:

- `VTD booked users`
- `VTD completed users`
- `BCs`

## Current HubSpot mapping

The app is currently wired to these live properties:

- Deal `virtual_test_drive_status`
- Deal `virtual_test_drive_booked_by`
- Deal `test_drive_status`
- Deal `booking_confirm_date`
- Deal `delivery_state`
- Deal `interstate_sale_yesno`
- Deal `virtual_test_drive_status_timestamp`
- Contact `email`
- Contact `check_in_walk_in_date`
- Contact `vehicle_state`

## Logic

- Booked users: unique associated contacts on deals where `virtual_test_drive_status` is `BOOKED` or `COMPLETED`
- Completed users: booked users with either `test_drive_status = Test Drive Done / COMPLETED` or a contact `check_in_walk_in_date`
- BCs: unique filtered contacts with at least one associated deal where `booking_confirm_date` exists
- Exclusions: contact emails containing `cars24` or `yopmail`

## Local run

1. Create `.env` from `.env.example`
2. Set `HUBSPOT_TOKEN`
3. Run `npm install`
4. Run `npm run dev`

## Deploy

This project is ready for a Vercel deploy:

1. Import the folder into Vercel
2. Add environment variable `HUBSPOT_TOKEN`
3. Optionally add `HUBSPOT_DASHBOARD_CONFIG`
4. Deploy

The dashboard frontend calls `/api/dashboard`, so the deployed URL is shareable directly.
