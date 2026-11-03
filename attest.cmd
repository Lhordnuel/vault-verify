@echo off
setlocal
set "ATTEST_CLI=%~dp0packages\cli\dist\cli.js"
if not exist "%ATTEST_CLI%" (
  echo Attest CLI is not built yet.
  echo Run npm.cmd install and npm.cmd run build -w @attest/cli from the Attest repository.
  exit /b 1
)
node "%ATTEST_CLI%" %*
exit /b %ERRORLEVEL%
