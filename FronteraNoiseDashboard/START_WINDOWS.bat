@echo off
echo Starting Frontera Noise Dashboard...
if not exist node_modules (
  echo Installing dependencies for the first time...
  call npm install
)
start http://localhost:3000
call npm run dev
pause
