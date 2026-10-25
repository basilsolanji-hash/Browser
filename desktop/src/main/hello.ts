import { execFile } from 'node:child_process';

/**
 * Подтверждение Windows Hello перед показом и копированием пароля (как подтверждение PIN/отпечатком
 * на Android). Прямого API в Electron нет: WinRT UserConsentVerifier через PowerShell.
 * Hello не настроен (или это не Windows) — показываем без проверки, как Android без блокировки экрана.
 */
const SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' } | Select-Object -First 1
function Wait-Op($op, $type) { $task = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); $task.Wait(-1) | Out-Null; $task.Result }
$v = [Windows.Security.Credentials.UI.UserConsentVerifier, Windows.Security.Credentials.UI, ContentType = WindowsRuntime]
$a = Wait-Op ($v::CheckAvailabilityAsync()) ([Windows.Security.Credentials.UI.UserConsentVerifierAvailability])
if ("$a" -ne 'Available') { 'NA'; exit 0 }
$r = Wait-Op ($v::RequestVerificationAsync($env:OS_HELLO_MSG)) ([Windows.Security.Credentials.UI.UserConsentVerificationResult])
"$r"
`;

let busy: Promise<boolean> | null = null;

export function verify(message: string): Promise<boolean> {
  if (process.env.OS_TEST === '1' || process.platform !== 'win32') return Promise.resolve(true);
  // Два запроса подряд (двойной щелчок) — одно окно Hello.
  busy ??= new Promise<boolean>((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', SCRIPT],
      { env: { ...process.env, OS_HELLO_MSG: message }, timeout: 120_000, windowsHide: true },
      (err, stdout) => {
        const out = String(stdout).trim().split(/\r?\n/).pop() ?? '';
        // Не удалось спросить — не показываем (кроме случая «Hello не настроен»).
        resolve(out === 'NA' || (!err && out === 'Verified'));
      });
  }).finally(() => { busy = null; });
  return busy;
}
