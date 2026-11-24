@echo off
title OYMIKE TECH - Espace Administrateur general
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js n'est pas installe sur cet ordinateur.
  echo.
  echo 1. Ouvrez https://nodejs.org/fr/download
  echo 2. Telechargez la version LTS pour Windows
  echo 3. Installez-la en laissant toutes les options par defaut
  echo 4. Relancez ce fichier
  echo.
  start https://nodejs.org/fr/download
  pause
  exit /b 1
)
node demarrer.js
echo.
pause
