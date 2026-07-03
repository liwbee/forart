@echo off
cd /d "%~dp0"

set "FORART_DATA_ROOT=%~dp0.forart-data"
set "FORART_DATA_DIR=%FORART_DATA_ROOT%\library"
set "FORART_DATABASE_DIR=%FORART_DATA_ROOT%\database"

call npm run dev
