declare module "xlsx" {
  export type WorkBook = {
    SheetNames: string[]
    Sheets: Record<string, unknown>
  }
  export function read(data: Buffer | ArrayBuffer, opts?: { type?: string; cellDates?: boolean }): WorkBook
  export const utils: {
    sheet_to_json: (sheet: unknown, opts?: { header?: number; defval?: string; raw?: boolean }) => unknown[][]
  }
}
