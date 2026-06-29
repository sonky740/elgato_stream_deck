#requires -Version 5
<#
.SYNOPSIS
  Windows SMTC 헬퍼(.NET)를 빌드해 플러그인에 vendor 한다.

.DESCRIPTION
  smtc-helper/ 를 dotnet publish 하고 결과를
  com.sonky.media-controller.sdPlugin/vendor/smtc-helper/ 에 복사한다.
  windows.ts 는 거기의 smtc-helper.exe 를 out-of-process 로 실행한다.

  요구: .NET 8 SDK + Windows 10.0.19041+ SDK.
  - 기본(프레임워크 의존, 작음): 대상 머신에 .NET 8 런타임 필요 (WinRT 콘솔 앱 — Desktop 런타임 아님).
  - -SelfContained: 런타임 불필요하지만 산출물이 큼(수십 MB).

.EXAMPLE
  pwsh scripts/build-smtc-helper.ps1
  pwsh scripts/build-smtc-helper.ps1 -SelfContained
#>
param([switch]$SelfContained)

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$proj = Join-Path $here "..\smtc-helper\smtc-helper.csproj"
$vendor = Join-Path $here "..\com.sonky.media-controller.sdPlugin\vendor\smtc-helper"
$pub = Join-Path ([System.IO.Path]::GetTempPath()) "smtc-helper-publish"

$sc = if ($SelfContained) { "true" } else { "false" }
Write-Host "→ dotnet publish (self-contained=$sc, win-x64)"
dotnet publish $proj -c Release -r win-x64 --self-contained $sc -p:PublishSingleFile=true -o $pub

Write-Host "→ vendoring → $vendor"
if (Test-Path $vendor) { Remove-Item -Recurse -Force $vendor }
New-Item -ItemType Directory -Force -Path $vendor | Out-Null
# 단일 파일 publish 결과 전체 복사(WinRT 투영/네이티브 동반 파일 포함될 수 있음).
Copy-Item -Path (Join-Path $pub "*") -Destination $vendor -Recurse -Force

$exe = Join-Path $vendor "smtc-helper.exe"
if (Test-Path $exe) {
	Write-Host "✔ done: $exe"
	Write-Host "  검증: `"$exe`" get   (재생 중이면 곡 JSON, 아니면 null)"
} else {
	Write-Error "publish 산출물에 smtc-helper.exe 가 없습니다."
}
