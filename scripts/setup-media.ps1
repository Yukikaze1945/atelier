param([switch]$DownloadOnly)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$dependencyRoot = Join-Path $projectRoot '.deps'
$version = '1.28.6'
$installerName = "gstreamer-1.0-msvc-x86_64-$version.exe"
$downloadUrl = "https://gstreamer.freedesktop.org/pkg/windows/$version/msvc/$installerName"
$installer = Join-Path $dependencyRoot $installerName
$installRoot = Join-Path $dependencyRoot 'gstreamer'
New-Item -ItemType Directory -Force -Path $dependencyRoot | Out-Null
$checksum = (Invoke-RestMethod -Uri "$downloadUrl.sha256sum").Trim().Split(' ')[0]
$actual = if (Test-Path -LiteralPath $installer) { (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash } else { '' }
if ($actual -ine $checksum) {
    Write-Host "Downloading official GStreamer $version runtime and development bundle..."
    $proxy = [System.Net.WebRequest]::GetSystemWebProxy().GetProxy([Uri]$downloadUrl)
    $proxyArgs = @()
    if ($proxy.Host -ne ([Uri]$downloadUrl).Host) { $proxyArgs = @('--proxy', $proxy.AbsoluteUri) }
    for ($attempt = 0; $attempt -lt 15; $attempt++) {
        & curl.exe @proxyArgs --fail --location --continue-at - --connect-timeout 20 --silent --show-error --output $installer $downloadUrl
        $actual = if (Test-Path -LiteralPath $installer) { (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash } else { '' }
        if ($actual -ieq $checksum) { break }
        Write-Host "Resuming interrupted download (attempt $($attempt + 1))."
    }
}
$actual = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash
if ($actual -ine $checksum) { throw 'GStreamer installer SHA256 mismatch.' }
Write-Host "Verified SHA256: $actual"
if ($DownloadOnly) { return }
if (-not (Test-Path -LiteralPath (Join-Path $installRoot 'include/gstreamer-1.0/ges/ges.h'))) {
    $arguments = @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/CURRENTUSER', '/TYPE=devel', '/NORESTART', '/NOICONS', "/DIR=`"$installRoot`"", "/LOG=`"$dependencyRoot/gstreamer-install.log`"")
    $process = Start-Process -FilePath $installer -ArgumentList $arguments -WindowStyle Hidden -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw "GStreamer install failed: $($process.ExitCode)" }
}
if (-not (Test-Path -LiteralPath (Join-Path $installRoot 'bin/gst-inspect-1.0.exe'))) { throw 'GStreamer runtime is missing after installation.' }
Write-Host "GStreamer ready at $installRoot"
