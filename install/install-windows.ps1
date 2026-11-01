# AI WIKI 설치 도우미 (Windows PowerShell) — git, Claude Code, GitHub 로그인, AI WIKI 내려받기, 자동 커밋
# 실행: PowerShell에서  powershell -ExecutionPolicy Bypass -File .\install-windows.ps1   (미리 보기: -DryRun)
param([switch]$DryRun,[string]$RepoUrl=$(if($env:AIWIKI_REPO){$env:AIWIKI_REPO}else{"https://github.com/계정이름/ai-wiki.git"}))
$Target = Join-Path $HOME "Desktop\ai-wiki"
function Run($cmd){ Write-Host "▶ $cmd"; if(-not $DryRun){ Invoke-Expression $cmd } }
function Has($n){ [bool](Get-Command $n -ErrorAction SilentlyContinue) }
Write-Host "`n=== 1/5 Git for Windows ==="
if(Has git){ git --version } else { Run "winget install --id Git.Git -e --source winget"; Write-Host "설치 후 PowerShell을 다시 열고 이 파일을 다시 실행하세요."; exit }
Write-Host "`n=== 2/5 Claude Code ==="
if(Has claude){ claude --version } else { Run "irm https://claude.ai/install.ps1 | iex" }
Write-Host "`n=== 3/5 깃허브 로그인 ==="
if(-not (Has gh)){ Run "winget install --id GitHub.cli -e --source winget" }
if(Has gh){ gh auth status 2>$null; if($LASTEXITCODE -ne 0){ Run "gh auth login --web --git-protocol https" } }
Write-Host "`n=== 4/5 AI WIKI 내려받기 ==="
if(Test-Path (Join-Path $Target ".git")){ Run "git -C `"$Target`" pull --ff-only" } else {
  if($RepoUrl -like "*계정이름*"){ $RepoUrl = Read-Host "AI WIKI 저장소 주소(https://github.com/…/ai-wiki.git)" }
  if(-not $RepoUrl){ Write-Host "저장소 주소가 없어 중단합니다."; exit 1 }
  Run "git clone `"$RepoUrl`" `"$Target`"" }
Write-Host "`n=== 5/5 자동 커밋 ==="
Write-Host "자동 커밋: $Target 에서 Claude Code를 쓰면 답변이 끝날 때마다 바뀐 파일이 깃허브에 커밋·푸시됩니다(Git Bash로 훅 실행)."
Write-Host "끄려면: $Target 안에 .no-auto-commit 파일 만들기"
if((Read-Host "지금 AI WIKI를 열까요? (y/n)") -eq "y"){ Run "Start-Process `"$Target\start-windows.bat`"" }
Write-Host "`nClaude Code로 앱을 고치려면: cd `"$Target`"; claude"
