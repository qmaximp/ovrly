@echo off
cd /d "%~dp0.."
"C:\Program Files\nodejs\node.exe" --env-file=.env.local scripts\telegram-bridge.mjs >> "%~dp0..\logs-telegram-bridge.txt" 2>&1
