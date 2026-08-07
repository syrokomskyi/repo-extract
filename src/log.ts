/*
<MODULE_CONTRACT>
<purpose>Minimal logging abstraction — gates console output on verbose flag for library-grade use.</purpose>
<non-goals>
  <item>Does not implement structured logging or log levels beyond log/error.</item>
  <item>Does not depend on external logging libraries.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0074: Initial logger — Logger interface and createLogger factory.</item>
</CHANGE_SUMMARY>
*/

export interface Logger {
  log(msg: string): void;
  error(msg: string): void;
}

export function createLogger(verbose?: boolean): Logger {
  return {
    log: (msg) => {
      if (verbose) console.log(msg);
    },
    error: (msg) => {
      console.error(msg);
    },
  };
}
