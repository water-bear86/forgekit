import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import {
  getAuth,
  GithubAuthProvider,
  GoogleAuthProvider,
  signInWithPopup,
  type Auth,
  type AuthProvider,
} from "firebase/auth";
import { firebaseClientConfig } from "../shared/config";

let authInstance: Auth | null = null;

export function firebaseApp(): FirebaseApp {
  return getApps()[0] ?? initializeApp(firebaseClientConfig());
}

export function firebaseAuth(): Auth {
  authInstance ??= getAuth(firebaseApp());
  return authInstance;
}

async function signInWith(provider: AuthProvider) {
  return signInWithPopup(firebaseAuth(), provider);
}

export function signInWithGoogle() {
  return signInWith(new GoogleAuthProvider());
}

export function signInWithGithub() {
  return signInWith(new GithubAuthProvider());
}
