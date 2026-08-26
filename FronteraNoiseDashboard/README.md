# Frontera Data Labs — Home Noise Dashboard

A local-first Next.js dashboard for exploring CSV data exported by StreetNoise Monitor.

The application reads the CSV directly in your browser. It does not upload the file to a server.

## Required software

- Node.js 20.9 or newer: https://nodejs.org/
- A modern browser such as Chrome or Edge
- Git (optional, for GitHub): https://git-scm.com/

## Run it locally

1. Extract this project ZIP.
2. Open the extracted FronteraNoiseDashboard folder in Visual Studio Code or a terminal.
3. Run: npm install
4. Run: npm run dev
5. Open http://localhost:3000 in your browser.
6. Scroll down, choose your exported CSV, and enter the dashboard.

Stop the server by pressing Ctrl+C in the terminal.

### Easier Windows option

After installing Node.js, double-click START_WINDOWS.bat. The first run installs the project dependencies automatically and opens the dashboard.

### Easier macOS or Linux option

Open a terminal in the project folder and run:

    ./start-mac-linux.sh

## Verify the production build

Run: npm run build

Then run: npm start

Open http://localhost:3000.

## Expected CSV fields

Required columns:

- timestamp_utc_iso
- leq_dbfs
- peak_dbfs

Optional supported columns:

- interval_seconds
- battery_percent
- temperature_c
- humidity_percent
- wind_speed_mps

The included sample is located at public/sample-noise.csv.

## Create your GitHub repository

Create an empty repository on GitHub. From inside this project folder, run:

    git init
    git add .
    git commit -m "Initial Frontera noise dashboard"
    git branch -M main
    git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPOSITORY.git
    git push -u origin main

Replace the example GitHub URL with the address of your empty repository.

## Current calculations

- Energy-average Leq in dBFS
- Median Leq
- Maximum instantaneous peak
- Observed time and coverage
- L10–L90 acoustic spread
- Elevated readings at least 6 dB above the selected median
- Ten-minute bins across midnight-to-midnight
- Individual daily traces, cross-day median, and selected-day trace

## Measurement limitation

leq_dbfs and peak_dbfs are digital full-scale measurements. They are useful for relative patterns on the same device, but they are not calibrated dB SPL or A-weighted dB(A). Do not compare them directly with WHO environmental-noise thresholds.
