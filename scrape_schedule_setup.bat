@echo off
chcp 65001 > nul
rem Register Sedori Radar scraping to run twice a day (08:00 and 20:00)
set TASK_NAME=SedoriRadarScrape
set SCRIPT_PATH=%~dp0run_scrape.bat

echo Registering scheduled tasks...
schtasks /create /tn "%TASK_NAME%_AM" /tr "\"%SCRIPT_PATH%\"" /sc daily /st 08:00 /f
schtasks /create /tn "%TASK_NAME%_PM" /tr "\"%SCRIPT_PATH%\"" /sc daily /st 20:00 /f

if %errorlevel% == 0 (
    echo.
    echo === Done! ===
    echo Scraping will run automatically at 08:00 and 20:00 every day.
    echo Task names: %TASK_NAME%_AM / %TASK_NAME%_PM
    echo.
    echo To change the time, run in an admin PowerShell:
    echo schtasks /change /tn "%TASK_NAME%_AM" /st HH:MM
) else (
    echo.
    echo Error: please run as administrator.
    echo Right-click this .bat and choose "Run as administrator".
)
pause
