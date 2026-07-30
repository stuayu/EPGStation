#Requires -Version 5.1
<#
.SYNOPSIS
    EPGStation を Windows サービスとして登録する。

.DESCRIPTION
    winser でサービスを登録したあと、サービス実行時に必要な環境を整える。
    winser (nssm) が作るサービスは既定で LocalSystem・セッション 0 で動くため、
    追加の設定をしないと以下が動かない。

      * git がユーザーの PATH にしか入っていない場合に見つからない
        (Git for Windows を「現在のユーザーのみ」でインストールした場合)
      * リポジトリの所有者 (インストールしたユーザー) とサービスの実行アカウント
        (SYSTEM) が違うため、git が dubious ownership で全コマンド失敗する
      * ffmpeg / tsreadex 等をユーザーの PATH に置いている場合に見つからない
      * ワンクリック更新後に上がってこない (サービスの回復設定が既定のままのため)

    このスクリプトは登録後に次を設定する。

      1. サービス専用の環境変数 (PATH に node / git / ffmpeg のディレクトリを追加、
         EPGSTATION_SERVICE_MANAGER / EPGSTATION_WIN_SERVICE_NAME)
      2. git の safe.directory (--system。SYSTEM アカウントからも有効)
      3. サービスの回復設定 (失敗時に自動で再起動)
      4. 遅延自動起動 (Mirakurun / チューナーの初期化を待つ)
      5. -User 指定時は実行アカウントの変更 (ユーザーの環境で動かしたい場合)

.PARAMETER ServiceName
    サービス名。既定は epgstation (winser が package.json の name から作る名前)

.PARAMETER User
    サービスの実行アカウント。例: '.\epgstation' / 'DOMAIN\user'
    省略時は winser の既定 (LocalSystem) のまま。
    指定する場合は事前に「サービスとしてログオン」権限が必要

.PARAMETER Password
    -User を指定した場合のパスワード。省略すると対話で入力を求める

.PARAMETER SkipWinser
    サービスの登録 (winser -i -a) を行わず、既に登録済みのサービスへ設定だけを追加する

.EXAMPLE
    npm run install-win-service

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\scripts\install-win-service.ps1 -User '.\epgstation'
#>
[CmdletBinding()]
param(
    [string]$ServiceName = 'epgstation',
    [string]$User,
    [System.Security.SecureString]$Password,
    [switch]$SkipWinser
)

$ErrorActionPreference = 'Stop'

# EPGStation の設置ディレクトリ (このスクリプトの 1 つ上)
$root = Split-Path -Parent $PSScriptRoot

function Assert-Administrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'このスクリプトは管理者権限で実行してください (PowerShell を「管理者として実行」)'
    }
}

# コマンドの実体があるディレクトリを返す (見つからない場合は $null)
function Get-CommandDirectory([string]$name) {
    $command = Get-Command $name -ErrorAction SilentlyContinue
    if ($null -eq $command) { return $null }
    $source = $command.Source
    if ([string]::IsNullOrEmpty($source)) { return $null }
    return Split-Path -Parent $source
}

# config.yml に絶対パスで書かれた実行ファイルのディレクトリを集める
# (ffmpeg / ffprobe / tsreadex をユーザーの PATH だけに置いている環境への保険)
function Get-ConfiguredToolDirectories {
    $configPath = Join-Path $root 'config\config.yml'
    if (-not (Test-Path $configPath)) { return @() }
    $directories = @()
    foreach ($line in Get-Content -LiteralPath $configPath -Encoding UTF8) {
        if ($line -notmatch '^\s*(ffmpeg|ffprobe|tsreadex|qsvencc|nvencc|vceencc)\s*:\s*(.+?)\s*$') { continue }
        $value = $Matches[2].Trim().Trim("'", '"')
        if ([string]::IsNullOrWhiteSpace($value)) { continue }
        # PATH 上のコマンド名だけを書いている場合は対象外
        if ($value -notmatch '[\\/]') { continue }
        $directory = Split-Path -Parent $value
        if ((-not [string]::IsNullOrWhiteSpace($directory)) -and (Test-Path -LiteralPath $directory)) {
            $directories += $directory
        }
    }
    return $directories
}

# サービス専用の環境変数を設定する (REG_MULTI_SZ の 'NAME=VALUE' の並び)
# nssm はここで設定した環境をサービスのプロセスへ引き継ぐ
function Set-ServiceEnvironment([string]$name, [string[]]$entries) {
    $key = "HKLM:\SYSTEM\CurrentControlSet\Services\$name"
    if (-not (Test-Path $key)) {
        throw "サービス $name が見つかりません"
    }
    Set-ItemProperty -Path $key -Name 'Environment' -Value $entries -Type MultiString
}

Assert-Administrator

Write-Host "EPGStation のディレクトリ: $root"

if (-not $SkipWinser) {
    if ($null -eq (Get-Command winser -ErrorAction SilentlyContinue)) {
        throw 'winser が見つかりません。先に "npm install winser -g" を実行してください'
    }
    Write-Host 'サービスを登録します (winser -i -a)'
    Push-Location $root
    try {
        & winser -i -a
        if ($LASTEXITCODE -ne 0) { throw "winser の実行に失敗しました (exit $LASTEXITCODE)" }
    }
    finally {
        Pop-Location
    }
}

if ($null -eq (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue)) {
    throw "サービス $ServiceName が見つかりません。-ServiceName で正しい名前を指定してください"
}

# --- 1. サービス専用の環境変数 ---------------------------------------------
# マシン全体の PATH を土台に、node / git / config.yml のツールのディレクトリを足す。
# ユーザースコープの PATH はサービスからは見えないため、ここで明示的に補う
$pathEntries = New-Object System.Collections.Generic.List[string]
$machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
if (-not [string]::IsNullOrWhiteSpace($machinePath)) {
    foreach ($entry in $machinePath.Split(';')) {
        if (-not [string]::IsNullOrWhiteSpace($entry)) { $pathEntries.Add($entry.TrimEnd('\')) }
    }
}
$extraDirectories = @()
foreach ($name in @('node', 'npm', 'git')) {
    $directory = Get-CommandDirectory $name
    if ($null -ne $directory) { $extraDirectories += $directory }
}
$extraDirectories += Get-ConfiguredToolDirectories
foreach ($directory in $extraDirectories) {
    $normalized = $directory.TrimEnd('\')
    if (-not ($pathEntries -contains $normalized)) {
        $pathEntries.Add($normalized)
        Write-Host "サービスの PATH に追加: $normalized"
    }
}

$environment = @(
    "Path=$($pathEntries -join ';')",
    # 更新後の再起動方法を自動判定させず確定させる (src/model/update/UpdateEnvironment.ts)
    'EPGSTATION_SERVICE_MANAGER=windows-service',
    "EPGSTATION_WIN_SERVICE_NAME=$ServiceName"
)
Set-ServiceEnvironment -name $ServiceName -entries $environment
Write-Host 'サービスの環境変数を設定しました'

# --- 2. git の safe.directory ----------------------------------------------
# リポジトリの所有者とサービスの実行アカウントが異なると git が全コマンド失敗するため、
# システム全体の設定として許可する (SYSTEM アカウントからも読まれる)
$gitCommand = Get-Command git -ErrorAction SilentlyContinue
if ($null -eq $gitCommand) {
    Write-Warning 'git が見つかりません。ワンクリック更新を使う場合は Git for Windows を「すべてのユーザー」向けにインストールしてください'
}
else {
    # git の設定値はパス区切りに / を使う
    $gitRoot = $root.Replace('\', '/')
    $registered = & git config --system --get-all safe.directory 2>$null
    if ($registered -notcontains $gitRoot) {
        & git config --system --add safe.directory $gitRoot
        Write-Host "git の safe.directory に追加しました: $gitRoot"
    }
    else {
        Write-Host "git の safe.directory は既に登録済みです: $gitRoot"
    }
}

# --- 3. 回復設定 (失敗時の自動再起動) --------------------------------------
# ワンクリック更新はプロセスを終了して入れ替わる方式なので、ここが未設定だと更新後に停止したままになる
& sc.exe failure $ServiceName reset= 86400 actions= restart/5000/restart/10000/restart/30000 | Out-Null
if ($LASTEXITCODE -eq 0) { Write-Host '回復設定 (失敗時に自動再起動) を設定しました' }
else { Write-Warning "回復設定に失敗しました (exit $LASTEXITCODE)" }

# --- 4. 遅延自動起動 --------------------------------------------------------
# 起動直後は Mirakurun やチューナーの初期化が終わっていないことがあるため遅延させる
& sc.exe config $ServiceName start= delayed-auto | Out-Null
if ($LASTEXITCODE -eq 0) { Write-Host '遅延自動起動に設定しました' }
else { Write-Warning "スタートアップの種類の変更に失敗しました (exit $LASTEXITCODE)" }

& sc.exe description $ServiceName 'EPGStation (DTV recording manager)' | Out-Null

# --- 5. 実行アカウントの変更 (任意) ----------------------------------------
if (-not [string]::IsNullOrWhiteSpace($User)) {
    if ($null -eq $Password) {
        $Password = Read-Host -AsSecureString "$User のパスワードを入力してください"
    }
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
        [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Password))
    & sc.exe config $ServiceName obj= $User password= $plain | Out-Null
    $exitCode = $LASTEXITCODE
    $plain = $null
    if ($exitCode -eq 0) {
        Write-Host "サービスの実行アカウントを $User に変更しました"
        Write-Host '  (このアカウントに「サービスとしてログオン」権限と、録画先ディレクトリの書き込み権限が必要です)'
    }
    else {
        Write-Warning "実行アカウントの変更に失敗しました (exit $exitCode)"
    }
}

Write-Host ''
Write-Host '設定が完了しました。次のコマンドで起動できます:'
Write-Host "  net start $ServiceName"
