@echo off
cd /d "%~dp0"
if not exist node_modules call npm install
set OPEN_BROWSER=1
npm start
