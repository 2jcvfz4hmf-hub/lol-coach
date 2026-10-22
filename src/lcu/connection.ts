import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { request } from "node:https";
import { promisify } from "node:util";

// Le client LoL expose une API locale (« LCU ») protégée par un mot de passe
// qui change à chaque lancement. On le retrouve soit dans le fichier lockfile
// du dossier d'installation, soit dans la ligne de commande du processus.

export interface LcuCredentials {
  port: number;
  password: string;
}

const LOCKFILE_PATHS = [
  "C:\\Riot Games\\League of Legends\\lockfile",
  "D:\\Riot Games\\League of Legends\\lockfile",
];

export function parseLockfile(content: string): LcuCredentials | undefined {
  // Format : name:pid:port:password:protocol
  const parts = content.trim().split(":");
  const port = Number(parts[2]);
  const password = parts[3];
  return port && password ? { port, password } : undefined;
}

export function parseCommandLine(commandLine: string): LcuCredentials | undefined {
  const port = Number(commandLine.match(/--app-port=(\d+)/)?.[1]);
  const password = commandLine.match(/--remoting-auth-token=([\w-]+)/)?.[1];
  return port && password ? { port, password } : undefined;
}

async function fromProcess(): Promise<LcuCredentials | undefined> {
  if (process.platform !== "win32") return undefined;
  try {
    const { stdout } = await promisify(execFile)(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        "Get-CimInstance Win32_Process -Filter \"name='LeagueClientUx.exe'\" | Select-Object -ExpandProperty CommandLine",
      ],
      { windowsHide: true },
    );
    return parseCommandLine(stdout);
  } catch {
    return undefined;
  }
}

/** Cherche le client LoL lancé. Renvoie undefined s'il n'est pas ouvert. */
export async function findClient(): Promise<LcuCredentials | undefined> {
  const viaProcess = await fromProcess();
  if (viaProcess) return viaProcess;
  for (const p of LOCKFILE_PATHS) {
    try {
      const creds = parseLockfile(await readFile(p, "utf8"));
      if (creds) return creds;
    } catch {
      // Pas installé à cet endroit.
    }
  }
  return undefined;
}

export class LcuError extends Error {
  constructor(public status: number) {
    super(`Client LoL : HTTP ${status}`);
  }
}

export function lcuGet<T>(creds: LcuCredentials, path: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: "127.0.0.1",
        port: creds.port,
        path,
        method: "GET",
        headers: { Authorization: `Basic ${Buffer.from(`riot:${creds.password}`).toString("base64")}`, Accept: "application/json" },
        // Le client utilise un certificat auto-signé, uniquement en local.
        rejectUnauthorized: false,
        timeout: 5000,
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          if (!res.statusCode || res.statusCode >= 400) return reject(new LcuError(res.statusCode ?? 0));
          try {
            resolve(JSON.parse(body) as T);
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("Client LoL : délai dépassé")));
    req.on("error", reject);
    req.end();
  });
}
