@echo off
rem Hades ako lokálna appka — dvojklik a si v grafe.
rem
rem Otvorí jedno okno bez adresného riadka, prihlásenie sa nepýta (token si appka
rem prečíta sama z .env). Ochrana `auth.ui` zostáva zapnutá — viď bin/hades-app.mjs.
rem
rem Ak Hades nebeží, spusti najprv `docker compose up -d` v koreni projektu.

setlocal
set "NODE=%ProgramFiles%\nodejs\node.exe"
if not exist "%NODE%" set "NODE=node"

pushd "%~dp0.."
"%NODE%" "bin\hades-app.mjs" %*
set "CODE=%ERRORLEVEL%"
popd

rem Okno konzoly nechaj otvorené len keď sa niečo pokazilo — nech je chyba čitateľná.
if not "%CODE%"=="0" (
    echo.
    echo Hades sa nespustil. Chybu vidis vyssie.
    pause
)
endlocal
