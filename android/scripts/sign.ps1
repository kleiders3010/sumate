# Signs the release AAB (Play upload) and APK (GitHub download) with the Sumate upload key in
# ~/jurisgames-signing. The keystore password lives in Windows Credential Manager
# ('jurisgames-sumate-release-keystore'); it is read into a process-local env var and never printed.
# First run (no key yet): creates the key and a random password, stores the password there.
# Usage: powershell -File android\scripts\sign.ps1 <outDir>
param([Parameter(Mandatory)][string]$OutDir)
$ErrorActionPreference = 'Continue'  # native tools write progress to stderr; exit codes are checked
$java = if ($env:JAVA_HOME) { Join-Path $env:JAVA_HOME 'bin' } else { Split-Path (Get-Command keytool).Source }
$keytool = Join-Path $java 'keytool.exe'; $jarsigner = Join-Path $java 'jarsigner.exe'
$dir = Join-Path $HOME 'jurisgames-signing'; $jks = Join-Path $dir 'jurisgames-sumate-release.jks'
$target = 'jurisgames-sumate-release-keystore'
Add-Type -Namespace Win32 -Name CredJ -MemberDefinition @'
[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
public struct CREDENTIAL { public int Flags; public int Type; public string TargetName; public string Comment; public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten; public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist; public int AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName; }
[DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)] public static extern bool CredRead(string target, int type, int flags, out IntPtr cred);
[DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)] public static extern bool CredWrite(ref CREDENTIAL cred, int flags);
[DllImport("advapi32.dll")] public static extern void CredFree(IntPtr cred);
'@

if (-not (Test-Path $jks)) {
  New-Item -ItemType Directory -Force $dir | Out-Null
  $bytes = New-Object byte[] 24; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $pw = [Convert]::ToBase64String($bytes).Replace('+', 'A').Replace('/', 'B').TrimEnd('=')
  $blob = [Runtime.InteropServices.Marshal]::StringToCoTaskMemUni($pw)
  $c = New-Object Win32.CredJ+CREDENTIAL
  $c.Type = 1; $c.TargetName = $target; $c.UserName = 'sumate-upload'; $c.Persist = 2
  $c.CredentialBlob = $blob; $c.CredentialBlobSize = $pw.Length * 2
  if (-not [Win32.CredJ]::CredWrite([ref]$c, 0)) { throw 'CredWrite failed.' }
  [Runtime.InteropServices.Marshal]::ZeroFreeCoTaskMemUnicode($blob)
  $env:JT_PW = $pw; $pw = $null
  & $keytool -genkeypair -keystore $jks -storetype PKCS12 -alias upload -keyalg RSA -keysize 4096 -validity 10000 `
    -dname 'CN=Juris Games, O=Juris Games, C=AR' -storepass:env JT_PW -keypass:env JT_PW 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "keytool failed ($LASTEXITCODE)" }
  Write-Output "created upload key $jks"
} else {
  $p = [IntPtr]::Zero
  if (-not [Win32.CredJ]::CredRead($target, 1, 0, [ref]$p)) { throw 'Keystore credential not found.' }
  try {
    $c = [Runtime.InteropServices.Marshal]::PtrToStructure($p, [type][Win32.CredJ+CREDENTIAL])
    $env:JT_PW = [Runtime.InteropServices.Marshal]::PtrToStringUni($c.CredentialBlob, $c.CredentialBlobSize / 2)
  } finally { [Win32.CredJ]::CredFree($p) }
}

try {
  $root = (Resolve-Path (Join-Path $PSScriptRoot '..\app\build\outputs')).Path
  New-Item -ItemType Directory -Force $OutDir | Out-Null
  $aab = Join-Path $OutDir 'sumate-play.aab'
  Copy-Item (Join-Path $root 'bundle\release\app-release.aab') $aab -Force
  & $jarsigner -keystore $jks -storepass:env JT_PW -sigalg SHA256withRSA -digestalg SHA-256 $aab upload | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "jarsigner failed ($LASTEXITCODE)" }
  # APK: zipalign then apksigner from the newest build-tools
  $sdk = (Get-Content (Join-Path $PSScriptRoot '..\local.properties') | Where-Object { $_ -match '^sdk.dir=' }) -replace '^sdk.dir=', '' -replace '\\\\', '\' -replace '\\:', ':'
  $bt = Get-ChildItem (Join-Path $sdk 'build-tools') | Sort-Object { [version]($_.Name -replace '[^0-9.].*$', '') } | Select-Object -Last 1
  $apk = Join-Path $OutDir 'Sumate.apk'; $aligned = Join-Path $OutDir 'aligned.apk'
  & (Join-Path $bt.FullName 'zipalign.exe') -f -p 4 (Join-Path $root 'apk\release\app-release-unsigned.apk') $aligned
  & (Join-Path $bt.FullName 'apksigner.bat') sign --ks $jks --ks-key-alias upload --ks-pass env:JT_PW --out $apk $aligned
  if ($LASTEXITCODE -ne 0) { throw "apksigner failed ($LASTEXITCODE)" }
  Remove-Item $aligned
  & $keytool -list -v -keystore $jks -storepass:env JT_PW -alias upload | Select-String 'SHA256:' | ForEach-Object { "upload key " + $_.Line.Trim() }
} finally { Remove-Item Env:JT_PW -ErrorAction SilentlyContinue }
