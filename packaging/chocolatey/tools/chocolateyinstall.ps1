$ErrorActionPreference = 'Stop'

$packageName = 'wagent'
$version = '0.2.0'
$toolsDir = "$(Split-Path -parent $MyInvocation.MyCommand.Definition)"

$packageArgs = @{
  packageName    = $packageName
  version       = $version
  fileType      = 'msi'
  url           = "https://github.com/crediblemark-official/WAGENT/releases/download/v$version/wagent-windows-x64.msi"
  softwareName  = 'wagent*'
  checksum      = ''
  checksumType  = 'sha256'
  silentArgs    = "/quiet /norestart"
  validExitCodes = @(0)
}

Install-ChocolateyPackage @packageArgs
