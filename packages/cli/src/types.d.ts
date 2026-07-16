declare module 'qrcode-terminal' {
  interface GenerateOptions {
    small?: boolean;
  }
  export function generate(qr: string, options?: GenerateOptions): void;
}
