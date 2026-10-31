GradeLine — install instructions
=================================

1. Extract this whole zip file first — right-click it and choose
   "Extract All", then open the extracted folder. Don't run the installer
   straight out of the zip preview window (the one that opens if you just
   double-click the zip without extracting) — Windows runs it from a
   temporary location there and it won't be able to find gradeline.html
   next to it. This is the single most common reason "nothing happens".

2. In the extracted folder, double-click "Install GradeLine.bat".
   A black command-line window will open briefly and print what it's
   doing, then wait for you to press a key before it closes — so you'll
   always see a "Done" message or an error message, never just silence.

   Windows may show a blue "Windows protected your PC" prompt the first
   time, because the file isn't signed by a paid publisher certificate —
   click "More info" then "Run anyway". This is expected for an in-house
   tool; the installer only copies one file and creates two shortcuts,
   nothing is downloaded from the internet and nothing needs admin rights.

3. A "GradeLine" icon appears on your Desktop and in your Start Menu.
   Double-click it any time — it opens straight in your default browser.

If you ran step 2 and it printed "Done" but you still don't see an icon,
check you're looking at your own Desktop (not OneDrive's "Desktop" if your
files are redirected there) — the installer prints the exact folder paths
it used, so scroll up in that window to see them.

If it printed a message about shortcuts failing, GradeLine still installed
successfully — that message tells you the exact folder to open it from,
you can just make your own shortcut to that file.

GradeLine runs entirely inside your browser: there's no server, no login,
and nothing you load (DXF files, exported sections) ever leaves your own
computer.

To update everyone to a newer version later: replace gradeline.html in this
folder with the new one Claude gives you, and have each person re-run
"Install GradeLine.bat" — it just overwrites the old copy in place, the
Desktop/Start Menu icons keep working.

To remove it: run "Uninstall GradeLine.bat".
