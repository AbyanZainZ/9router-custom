import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

// Some launchers (services, detached processes, stripped shells) start the
// server without APPDATA/LOCALAPPDATA. Falling back to the home directory keeps
// the desktop import working instead of silently reporting "no account".
function roamingAppData() {
  return process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
}

function localAppData() {
  return process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
}

export async function detectAutoClawInstalled() {
  const localDir = localAppData();
  const candidatePaths = [
    path.join(localDir, "Programs", "AutoClaw2", "AutoClaw.exe"),
    path.join(localDir, "Programs", "autoclaw", "AutoClaw.exe"),
    path.join(process.env.ProgramFiles || "", "AutoClaw2", "AutoClaw.exe"),
  ];

  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      return { installed: true, path: p };
    }
  }

  // Also check if app data exists
  const appData = roamingAppData();
  if (fs.existsSync(path.join(appData, "AutoClaw-oversea-official"))) {
    return { installed: true, path: path.join(appData, "AutoClaw-oversea-official") };
  }

  return { installed: false, path: null };
}

export async function getAutoClawLocalAccount() {
  const appData = roamingAppData();
  const baseDir = path.join(appData, "AutoClaw-oversea-official");
  const localStatePath = path.join(baseDir, "Local State");
  const accountsDir = path.join(baseDir, "accounts");

  if (!fs.existsSync(localStatePath) || !fs.existsSync(accountsDir)) {
    return null;
  }

  const dirs = fs.readdirSync(accountsDir);
  for (const dir of dirs) {
    const credPath = path.join(accountsDir, dir, "account-credentials.enc");
    const profilePath = path.join(accountsDir, dir, "account-profile.json");
    if (fs.existsSync(credPath)) {
      try {
        let profile = {};
        if (fs.existsSync(profilePath)) {
          try {
            profile = JSON.parse(fs.readFileSync(profilePath, "utf8"))?.profile || {};
          } catch {}
        }

        const localState = JSON.parse(fs.readFileSync(localStatePath, "utf8"));
        const encKeyBase64 = localState?.os_crypt?.encrypted_key;
        if (!encKeyBase64) continue;

        const psCmd = `powershell -NoProfile -Command "Add-Type -AssemblyName System.Security; $k=[Convert]::FromBase64String('${encKeyBase64}'); $dp=$k[5..($k.Length-1)]; $un=[System.Security.Cryptography.ProtectedData]::Unprotect($dp, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser); [BitConverter]::ToString($un).Replace('-','').ToLower()"`;
        const { stdout } = await execAsync(psCmd, { windowsHide: true });
        const hexKey = stdout.trim();
        if (!hexKey || hexKey.length !== 64) continue;

        const aesKey = Buffer.from(hexKey, "hex");
        const fileBytes = fs.readFileSync(credPath);

        const iv = fileBytes.subarray(3, 15);
        const tag = fileBytes.subarray(fileBytes.length - 16);
        const ciphertext = fileBytes.subarray(15, fileBytes.length - 16);

        const decipher = crypto.createDecipheriv("aes-256-gcm", aesKey, iv);
        decipher.setAuthTag(tag);
        const decryptedStr = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
        const creds = JSON.parse(decryptedStr);

        let deviceId = null;
        try {
          const payload = JSON.parse(Buffer.from(creds.accessToken.split(".")[1], "base64url").toString());
          deviceId = payload.device_id;
        } catch {}

        return {
          accessToken: creds.accessToken?.replace(/^Bearer\s+/i, ""),
          refreshToken: creds.refreshToken?.replace(/^Bearer\s+/i, ""),
          email: profile.email || null,
          displayName: profile.displayName || "AutoClaw User",
          deviceId,
        };
      } catch (err) {
        console.error("[autoclawLocal] Failed to decrypt local credentials:", err);
      }
    }
  }
  return null;
}
