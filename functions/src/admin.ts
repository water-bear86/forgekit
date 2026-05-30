import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

type StorageBucket = ReturnType<ReturnType<typeof getStorage>["bucket"]>;

export function adminApp() {
  if (getApps().length > 0) return getApps()[0];

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (raw) {
    try {
      return initializeApp({ credential: cert(JSON.parse(raw)) });
    } catch (error) {
      throw new Error(
        `Failed to initialize Firebase Admin from FIREBASE_SERVICE_ACCOUNT_JSON: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  return initializeApp();
}

export function firestore() {
  return getFirestore(adminApp());
}

export function storageBucket(): StorageBucket {
  const bucket =
    process.env.FORGEKIT_STORAGE_BUCKET ||
    process.env.FORGE_STORAGE_BUCKET ||
    process.env.FIREBASE_STORAGE_BUCKET ||
    "goblintown-88fd6.firebasestorage.app";
  return getStorage(adminApp()).bucket(bucket);
}

export async function requireFirebaseUid(authHeader: string | undefined): Promise<string> {
  const token = parseBearerToken(authHeader);
  if (!token) throw new Error("Firebase bearer token is required.");

  const decoded = await getAuth(adminApp()).verifyIdToken(token);
  return decoded.uid;
}

export function parseBearerToken(authHeader: string | undefined): string {
  const match = authHeader?.trim().match(/^bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? "";
}

export async function requireAdminUid(authHeader: string | undefined): Promise<string> {
  const uid = await requireFirebaseUid(authHeader);
  const allowlist = (process.env.FORGEKIT_ADMIN_UIDS ?? process.env.FORGE_ADMIN_UIDS ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  if (!allowlist.includes(uid)) throw new Error("Admin access denied.");
  return uid;
}
