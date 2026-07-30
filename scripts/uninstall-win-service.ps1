#Requires -Version 5.1
<#
.SYNOPSIS
    EPGStation の Windows サービス登録を解除する。

.DESCRIPTION
    サービスを停止してから winser で削除する。
    install-win-service.ps1 が追加した git の safe.directory は
    -KeepGitConfig を付けない場合に取り消す
    (サービス専用の環境変数と回復設定はサービスの削除と同時に消える)

.PARAMETER ServiceName
    サービス名。既定は epgstation

.PARAMETER KeepGitConfig
    git の safe.directory の設定を残す

.EXAMPLE
    npm run uninstall-win-service
#>
[CmdletBinding()]
param(
    [string]$ServiceName = 'epgstation',
    [switch]$KeepGitConfig
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot

function Assert-Administrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'このスクリプトは管理者権限で実行してください (PowerShell を「管理者として実行」)'
    }
}

Assert-Administrator

$service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($null -ne $service -and $service.Status -ne 'Stopped') {
    Write-Host "サービスを停止します: $ServiceName"
    Stop-Service -Name $ServiceName -Force
    # 停止完了を待つ (録画中の後始末で時間がかかることがある)
    $service.WaitForStatus('Stopped', (New-TimeSpan -Seconds 120))
}

if (-not $KeepGitConfig) {
    if ($null -ne (Get-Command git -ErrorAction SilentlyContinue)) {
        $gitRoot = $root.Replace('\', '/')
        $registered = & git config --system --get-all safe.directory 2>$null
        if ($registered -contains $gitRoot) {
            # 値を正規表現として解釈させないため --fixed-value を使う
            & git config --system --unset-all --fixed-value safe.directory $gitRoot 2>$null
            Write-Host "git の safe.directory から削除しました: $gitRoot"
        }
    }
}

if ($null -eq (Get-Command winser -ErrorAction SilentlyContinue)) {
    Write-Warning 'winser が見つかりません。"sc.exe delete <サービス名>" で手動削除してください'
    exit 1
}

Write-Host 'サービスを削除します (winser -r -x)'
Push-Location $root
try {
    & winser -r -x
    if ($LASTEXITCODE -ne 0) { throw "winser の実行に失敗しました (exit $LASTEXITCODE)" }
}
finally {
    Pop-Location
}

Write-Host 'サービス登録を解除しました'
