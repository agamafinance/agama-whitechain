/// The path the app is mounted under: /whitechain on app.agama.finance, through the main app's rewrite. next/link
/// and the router add it on their own; a plain <img src> does not, so every public asset goes through here.
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '/whitechain';

export const asset = (path: string) => `${BASE_PATH}${path}`;
