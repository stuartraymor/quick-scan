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
CloseApplications=yes
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

[UninstallDelete]
Type: files; Name: "{app}\Quick Scan source code.url"

[Run]
Filename: "{app}\{#AppExe}"; Description: "{cm:LaunchProgram,{#StringChange(AppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent
