declare module "sql.js" {
  export interface SqlValue {}
  type InitSqlJs = (config?: { locateFile?: (file: string) => string }) => Promise<{
    Database: new (data?: Uint8Array) => {
      prepare(sql: string): {
        step(): boolean;
        get(): Array<string | number | Uint8Array | null>;
        free(): void;
      };
      close(): void;
    };
  }>;
  const initSqlJs: InitSqlJs;
  export default initSqlJs;
}
