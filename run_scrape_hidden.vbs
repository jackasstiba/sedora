' === Hatsukore: run run_scrape.bat without showing a console window ===
'
' ASCII ONLY (same rule as run_scrape.bat). The Japanese rationale lives in run_scrape.md.
'
' Why this file exists: the scheduled task runs as the logged-on user, so cmd.exe pops a
' black window into the foreground twice a day. That is why the schedule was switched off
' on 2026-08-18. Launching through WScript.Shell.Run with window style 0 keeps it hidden.
'
' Run(..., 0, True) waits for the bat and returns its exit code, so the scheduler still
' records a real failure (LastTaskResult) instead of always reporting success.
Option Explicit

Dim sh, fso, here, rc
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = here
rc = sh.Run("""" & here & "\run_scrape.bat""", 0, True)
WScript.Quit rc
