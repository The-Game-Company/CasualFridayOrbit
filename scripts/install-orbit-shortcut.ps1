<#
  Creates a Start Menu shortcut "Orbit" that launches the dev build with the Orbit icon and,
  crucially, the same AppUserModelID the app sets at runtime (com.shozd.orbit). Matching the
  AUMID is what lets Windows pin it as ONE app (instead of grouping it under generic Electron
  or splitting into two taskbar buttons).

  Run once:   pwsh -ExecutionPolicy Bypass -File scripts\install-orbit-shortcut.ps1
  Then:       open Start, find "Orbit", right-click -> Pin to taskbar.

  By default it launches electron.exe directly on the built app (fast, no console window). Use
  -BuildFirst to point it at launch.cmd instead, which rebuilds before launching.
#>
param([switch]$BuildFirst)

$ErrorActionPreference = 'Stop'
$repo     = Split-Path $PSScriptRoot -Parent
$electron = Join-Path $repo 'node_modules\electron\dist\electron.exe'
$icon     = Join-Path $repo 'resources\orbit.ico'
$launch   = Join-Path $repo 'launch.cmd'
$aumid    = 'com.shozd.orbit'
$lnk      = Join-Path ([Environment]::GetFolderPath('Programs')) 'Orbit.lnk'

if (-not (Test-Path $electron)) { throw "electron.exe not found at $electron - run npm install first." }
if (-not (Test-Path $icon))     { throw "icon not found at $icon - run: node scripts/gen-icon.mjs" }

if ($BuildFirst) {
  $target = $launch; $args = ''; $workdir = $repo
} else {
  $target = $electron; $args = '"' + $repo + '"'; $workdir = $repo
}

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;

namespace OrbitShortcut {
  [ComImport, Guid("00021401-0000-0000-C000-000000000046")] public class CShellLink {}

  [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("000214F9-0000-0000-C000-000000000046")]
  public interface IShellLinkW {
    void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder f, int c, IntPtr p, uint x);
    void GetIDList(out IntPtr ppidl);
    void SetIDList(IntPtr pidl);
    void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder n, int c);
    void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string n);
    void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder d, int c);
    void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string d);
    void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder a, int c);
    void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string a);
    void GetHotkey(out short k); void SetHotkey(short k);
    void GetShowCmd(out int s); void SetShowCmd(int s);
    void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder p, int c, out int i);
    void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string p, int i);
    void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string p, uint r);
    void Resolve(IntPtr hwnd, uint f);
    void SetPath([MarshalAs(UnmanagedType.LPWStr)] string f);
  }

  [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("0000010b-0000-0000-C000-000000000046")]
  public interface IPersistFile {
    void GetClassID(out Guid id);
    [PreserveSig] int IsDirty();
    void Load([MarshalAs(UnmanagedType.LPWStr)] string f, uint m);
    void Save([MarshalAs(UnmanagedType.LPWStr)] string f, [MarshalAs(UnmanagedType.Bool)] bool remember);
    void SaveCompleted([MarshalAs(UnmanagedType.LPWStr)] string f);
    void GetCurFile([MarshalAs(UnmanagedType.LPWStr)] out string f);
  }

  [StructLayout(LayoutKind.Sequential, Pack=4)]
  public struct PROPERTYKEY { public Guid fmtid; public uint pid; }

  [StructLayout(LayoutKind.Explicit, Size=24)]
  public struct PROPVARIANT { [FieldOffset(0)] public ushort vt; [FieldOffset(8)] public IntPtr p; }

  [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99")]
  public interface IPropertyStore {
    void GetCount(out uint c);
    void GetAt(uint i, out PROPERTYKEY k);
    void GetValue(ref PROPERTYKEY k, out PROPVARIANT v);
    void SetValue(ref PROPERTYKEY k, ref PROPVARIANT v);
    void Commit();
  }

  // All COM work lives here: C# casts perform QueryInterface on the RCW (PowerShell's own
  // cast does not), so we expose one static entry point and call it from PowerShell.
  public static class Installer {
    [DllImport("ole32.dll")] static extern int PropVariantClear(ref PROPVARIANT pv);
    const ushort VT_LPWSTR = 31;

    public static void Create(string target, string args, string workdir, string icon, string aumid, string lnkPath) {
      IShellLinkW sl = (IShellLinkW)new CShellLink();
      sl.SetPath(target);
      if (!string.IsNullOrEmpty(args)) sl.SetArguments(args);
      sl.SetWorkingDirectory(workdir);
      sl.SetIconLocation(icon, 0);
      sl.SetDescription("Orbit");
      sl.SetShowCmd(1);

      // stamp the AppUserModelID so the shortcut unifies with the running window's AUMID.
      // Build a VT_LPWSTR PROPVARIANT by hand; PropVariantClear frees the string for us.
      IPropertyStore store = (IPropertyStore)sl;
      PROPERTYKEY key = new PROPERTYKEY();
      key.fmtid = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"); // PKEY_AppUserModel_ID
      key.pid = 5;
      PROPVARIANT pv = new PROPVARIANT();
      pv.vt = VT_LPWSTR;
      pv.p = Marshal.StringToCoTaskMemUni(aumid);
      store.SetValue(ref key, ref pv);
      store.Commit();
      PropVariantClear(ref pv);

      ((IPersistFile)sl).Save(lnkPath, true);
    }
  }
}
'@

[OrbitShortcut.Installer]::Create($target, $args, $workdir, $icon, $aumid, $lnk)

Write-Host "Created: $lnk"
Write-Host "AppUserModelID: $aumid  ->  target: $target $args"
Write-Host ""
Write-Host "Now open Start, find 'Orbit', right-click -> Pin to taskbar."
