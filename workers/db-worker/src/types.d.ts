/// <reference lib="esnext" />

// Minimal Cloudflare Workers–compatible ambient types (sufficient for db-worker)

declare function btoa(data: string): string
declare function atob(data: string): string

declare class TextEncoder {
  encode(input?: string): Uint8Array
}
declare class TextDecoder {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  decode(input?: any): string
}

declare function fetch(
  input: RequestInfo,
  init?: RequestInit,
): Promise<Response>

declare const crypto: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getRandomValues(array: any): any
  randomUUID(): string
  subtle: SubtleCrypto
}

declare class URL {
  constructor(url: string | URL, base?: string | URL)
  pathname: string
}

declare class Response {
  constructor(body?: BodyInit | null, init?: ResponseInit)
  headers: Headers
  ok: boolean
  json(): Promise<unknown>
}

declare class Headers {
  get(name: string): string | null
  set(name: string, value: string): void
}

declare class Request {
  constructor(input: RequestInfo, init?: RequestInit)
  method: string
  url: string
  headers: Headers
  json(): Promise<unknown>
}

type RequestInfo = Request | string
type BodyInit = string | ArrayBuffer

interface ResponseInit {
  headers?: HeadersInit
  status?: number
  statusText?: string
}

type HeadersInit = Record<string, string> | Headers

interface RequestInit {
  method?: string
  headers?: HeadersInit
  body?: BodyInit | null
}

interface SubtleCrypto {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  importKey(format: string, keyData: any, algorithm: any, extractable: boolean, keyUsages: any): Promise<CryptoKey>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sign(algorithm: any, key: CryptoKey, data: any): Promise<ArrayBuffer>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  verify(algorithm: any, key: CryptoKey, signature: any, data: any): Promise<boolean>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  deriveBits(algorithm: any, baseKey: CryptoKey, length: number): Promise<ArrayBuffer>
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface CryptoKey {}
