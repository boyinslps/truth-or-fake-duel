# 檢查並更新「真假對決」：和 GitHub 上的最新版比對，有新版就下載覆蓋程式。
# 不會動學生資料（data）、內附的 Node（node-portable）和套件（node_modules）。
# 用法：雙擊 update-class.bat；或 powershell -File update.ps1 [-CheckOnly] [-Quiet]
param([switch]$CheckOnly, [switch]$Quiet)

$ErrorActionPreference = 'Stop'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

$repo = 'boyinslps/truth-or-fake-duel'
$branch = 'main'
$root = $PSScriptRoot
$versionFile = Join-Path $root '.version'
$isGit = (Test-Path (Join-Path $root '.git')) -and [bool](Get-Command git -ErrorAction SilentlyContinue)

function Say($msg) { if (-not $Quiet) { Write-Host $msg } }

$timeout = if ($Quiet) { 4 } else { 20 }
try {
    $remote = (Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/commits/$branch" `
            -Headers @{ 'User-Agent' = 'zhenjia-duel-updater' } -TimeoutSec $timeout).sha
} catch {
    Say '連不上 GitHub，這次跳過更新檢查（要有網路才能更新）。'
    exit 0
}

# ── 判斷有沒有新版 ──
if ($isGit) {
    # 用 git 下載的資料夾：和遠端比對，落後才算有新版（自己多 commit 不算）
    git -C $root fetch origin $branch --quiet
    $behind = [int](git -C $root rev-list --count "HEAD..FETCH_HEAD")
    $hasUpdate = $behind -gt 0
} else {
    $local = if (Test-Path $versionFile) { (Get-Content $versionFile -Raw).Trim() } else { '' }
    $hasUpdate = $local -ne $remote
}

if (-not $hasUpdate) {
    Say '已經是最新版。'
    exit 0
}

if ($CheckOnly) {
    Write-Host '★ 有新版本可以更新：請先關閉伺服器，再雙擊 update-class.bat。'
    exit 10
}

# ── 更新 ──
if ($isGit) {
    Write-Host '用 git 更新中……'
    git -C $root pull --ff-only origin $branch
    if ($LASTEXITCODE -ne 0) {
        Write-Host '更新失敗：這個資料夾有改過的檔案，和新版衝突。請先處理或備份再更新。'
        exit 1
    }
    Write-Host '更新完成。請關掉伺服器視窗，再重新開啟 start-class.bat。'
    exit 0
}

Write-Host '正在下載新版……'
$tmp = Join-Path ([IO.Path]::GetTempPath()) ('zj-update-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
    $zip = Join-Path $tmp 'src.zip'
    Invoke-WebRequest -Uri "https://codeload.github.com/$repo/zip/$remote" -OutFile $zip -UseBasicParsing -TimeoutSec 180
    Expand-Archive -Path $zip -DestinationPath (Join-Path $tmp 'x') -Force
    $inner = Get-ChildItem (Join-Path $tmp 'x') -Directory | Select-Object -First 1
    if (-not $inner) { throw '下載的檔案內容不對' }

    $lock = Join-Path $root 'package-lock.json'
    $lockBefore = if (Test-Path $lock) { (Get-FileHash $lock).Hash } else { '' }

    # 只覆蓋、不刪除；學生資料、內附 Node、套件和 update-class.bat（正在執行）不動
    robocopy $inner.FullName $root /E /XD node-portable node_modules data .git /XF .version update-class.bat /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "複製檔案失敗（robocopy 代碼 $LASTEXITCODE）" }

    Set-Content -Path $versionFile -Value $remote -Encoding ascii
    $lockAfter = if (Test-Path $lock) { (Get-FileHash $lock).Hash } else { '' }

    Write-Host '更新完成。請關掉伺服器視窗，再重新開啟 start-class.bat。'
    if ($lockBefore -ne $lockAfter) {
        Write-Host '注意：這次更新有新增或升級套件，免安裝版內附的套件可能不夠用。如果伺服器打不開，請到 GitHub Releases 重新下載完整版。'
    }
} catch {
    Write-Host "更新失敗：$($_.Exception.Message)"
    exit 1
} finally {
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
