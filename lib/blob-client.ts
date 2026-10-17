import { get, put } from "@vercel/blob"

/** Shared Blob client so route tests can simulate a store failure without hitting the network. */
export const blobClient = { get, put }
