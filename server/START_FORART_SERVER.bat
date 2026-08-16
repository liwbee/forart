@echo off
cd /d "%~dp0"

set "FORART_DATA_ROOT=%~dp0.forart-data"
set "FORART_LIBRARY_DIR=%FORART_DATA_ROOT%\library"
set "FORART_DATA_DIR=%FORART_DATA_ROOT%\runtime"

call npm run dev
