; Quick Scan Windows installer (Inno Setup 6). Build with build-installer.ps1.
; AGPL-3.0-only, same as the application.

#ifndef AppVersion
  #error Pass /DAppVersion=x.y.z (build-installer.ps1 does this).
#endif
#ifndef SourceDir
  #error Pass /DSourceDir=<packaged app folder containing Quick Scan.exe>.
#endif
#ifndef OutputDirectory
  #define OutputDirectory "out"
#endif
#ifndef RepoUrl
  #define RepoUrl "https://github.com/stuartraymor/quick-scan"
#endif

#define AppName "Quick Scan"
#define AppExe "Quick Scan.exe"
#define Publisher "Quick Scan contributors"

[Setup]
; Never change AppId: it is how upgrades and the uninstaller find this product.
AppId={{7D1B6C58-3F0A-4E5B-9A4B-5C2E8A1D0F37}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#Publisher}
AppPublisherURL={#RepoUrl}
AppSupportURL={#RepoUrl}/issues
AppUpdatesURL={#RepoUrl}/releases
AppCopyright=ScanRuler (c) Stefan Hermann; Quick Scan modifications. AGPL-3.0-only.
VersionInfoVersion={#AppVersion}.0
VersionInfoProductName={#AppName}
VersionInfoProductVersion={#AppVersion}
VersionInfoCompany={#Publisher}
VersionInfoDescription={#AppName} Setup
VersionInfoCopyright=AGPL-3.0-only
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
UninstallDisplayName={#AppName}
UninstallDisplayIcon={app}\{#AppExe}
SetupIconFile=..\public\favicon.ico
WizardStyle=modern
WizardImageFile=assets\wizard-164x314.png,assets\wizard-328x628.png
WizardSmallImageFile=assets\small-55.png,assets\small-110.png
LicenseFile=..\LICENSE
InfoBeforeFile=notice.txt
OutputDir={#OutputDirectory}
OutputBaseFilename=Quick-Scan-Setup-{#AppVersion}
Compression=lzma2/max
SolidCompression=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
; Per-user install by default (no admin prompt); the wizard offers all-users.
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
DisableProgramGroupPage=yes
; Quick Scan is closed by PrepareToInstall below (gently, then forced); the
; Restart Manager alone does not close an Electron app in a silent install.
CloseApplications=force
RestartApplications=no
MinVersion=10.0
#ifdef Sign
SignTool=qs
SignedUninstaller=yes
#endif

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked
Name: "associate"; Description: "Open .scanruler project files with {#AppName}"; GroupDescription: "File associations:"; Flags: unchecked

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\ATTRIBUTION.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\LICENSE"; DestDir: "{app}"; DestName: "LICENSE-AGPL-3.0.txt"; Flags: ignoreversion

[INI]
Filename: "{app}\Quick Scan source code.url"; Section: "InternetShortcut"; Key: "URL"; String: "{#RepoUrl}"

[Icons]
Name: "{autoprograms}\{#AppName}\{#AppName}"; Filename: "{app}\{#AppExe}"
Name: "{autoprograms}\{#AppName}\Source code and license"; Filename: "{app}\Quick Scan source code.url"
Name: "{autoprograms}\{#AppName}\Uninstall {#AppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; Tasks: desktopicon

[Registry]
Root: HKA; Subkey: "Software\Classes\.scanruler"; ValueType: string; ValueName: ""; ValueData: "QuickScan.Project"; Flags: uninsdeletevalue; Tasks: associate
Root: HKA; Subkey: "Software\Classes\QuickScan.Project"; ValueType: string; ValueName: ""; ValueData: "Quick Scan project"; Flags: uninsdeletekey; Tasks: associate
Root: HKA; Subkey: "Software\Classes\QuickScan.Project\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\{#AppExe},0"; Tasks: associate
Root: HKA; Subkey: "Software\Classes\QuickScan.Project\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#AppExe}"" ""%1"""; Tasks: associate

[InstallDelete]
; Install over the previous version cleanly: the old program files go first.
Type: filesandordirs; Name: "{app}\resources"
Type: filesandordirs; Name: "{app}\locales"

[UninstallDelete]
Type: files; Name: "{app}\Quick Scan source code.url"

[Run]
Filename: "{app}\{#AppExe}"; Description: "{cm:LaunchProgram,{#StringChange(AppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent
; An in-app update runs Setup silently with /RELAUNCH: open Quick Scan again afterwards.
Filename: "{app}\{#AppExe}"; Flags: nowait; Check: IsRelaunch

[Code]
function QuickScanRunning(): Boolean;
var
  Code: Integer;
begin
  Exec(ExpandConstant('{cmd}'), '/C tasklist /FI "IMAGENAME eq {#AppExe}" /NH | find /I "{#AppExe}" >nul', '', SW_HIDE, ewWaitUntilTerminated, Code);
  Result := Code = 0;
end;

// Close every running Quick Scan: first as a window close would (it keeps its
// recovery checkpoint), then, after 8 s, forced. Never /T: Setup itself may have
// been started by Quick Scan (in-app update) and must not be closed with it.
procedure CloseQuickScan();
var
  Code, I: Integer;
begin
  if not QuickScanRunning() then exit;
  Exec(ExpandConstant('{sys}\taskkill.exe'), '/IM "{#AppExe}"', '', SW_HIDE, ewWaitUntilTerminated, Code);
  for I := 1 to 16 do
  begin
    if not QuickScanRunning() then exit;
    Sleep(500);
  end;
  Exec(ExpandConstant('{sys}\taskkill.exe'), '/F /IM "{#AppExe}"', '', SW_HIDE, ewWaitUntilTerminated, Code);
  for I := 1 to 10 do
  begin
    if not QuickScanRunning() then exit;
    Sleep(500);
  end;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  Result := '';
  if not QuickScanRunning() then exit;
  if not WizardSilent() then
    if MsgBox('Quick Scan is open. Setup will close it before installing (work since your last save is kept in its recovery checkpoint).' + #13#10#13#10 + 'Close Quick Scan and continue?', mbConfirmation, MB_OKCANCEL) <> IDOK then
    begin
      Result := 'Quick Scan is still open. Close it, then run Setup again.';
      exit;
    end;
  CloseQuickScan();
  if QuickScanRunning() then
    Result := 'Quick Scan could not be closed. Close it, then run Setup again.';
end;

function InitializeUninstall(): Boolean;
begin
  CloseQuickScan();
  Result := True;
end;

function IsRelaunch(): Boolean;
begin
  Result := Pos('/RELAUNCH', Uppercase(GetCmdTail)) > 0;
end;
